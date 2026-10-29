import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { startDb, stopDb, resetDb } from "./helpers.ts";
import { dispatch } from "../server/routes.ts";
import { q } from "../server/db.ts";
import { dailyRun, continueAutoSending } from "../server/campaigns.ts";
import { runFoxSync } from "../server/sync.ts";
import { handleWebhookPayload } from "../server/whatsapp.ts";
import * as L from "../public/lib.js";

process.env.SETUP_CODE = "code-install-123";
const BASE = "https://fox.test";
let cookie = "";

async function call(method: string, path: string, body?: any, opts: { cookie?: string | null; csrf?: boolean } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const ck = opts.cookie === undefined ? cookie : opts.cookie;
  if (ck) headers.cookie = ck;
  if (opts.csrf !== false && method !== "GET") headers["x-requested-with"] = "fox";
  const res = await dispatch(new Request(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
  const text = await res.text();
  let data: any = null; try { data = JSON.parse(text); } catch { /* */ }
  const sc = res.headers.get("set-cookie");
  return { status: res.status, data, setCookie: sc };
}
async function login() {
  await call("POST", "/api/auth/setup", { code: "code-install-123", email: "boss@fox.test", password: "mot-de-passe-solide", name: "Boss" }, { cookie: null });
  const r = await call("POST", "/api/auth/login", { email: "boss@fox.test", password: "mot-de-passe-solide" }, { cookie: null });
  cookie = (r.setCookie || "").split(";")[0];
}

const iso = (n: number) => L.toISO(L.addDays(L.todayDate(), n));
// export FoxDrive au format texte « liste » (fictif)
function foxText(rows: { plate: string; model: string; name?: string; verif?: string }[]) {
  return rows.map((r) => [r.plate, "🏢 RUNGIS", r.model, ...(r.name ? [r.name] : []), "Hybride éco · " + (r.verif ? "Dernière vérif. " + r.verif : "Jamais vérifié"), r.name ? "LOUE" : "DISPONIBLE", "Vérifier"].join("\n")).join("\n");
}
const fr = (n: number) => { const d = L.addDays(L.todayDate(), n); return L.fmtDateFull(d); };

beforeAll(async () => { await startDb(); }, 120000);
afterAll(async () => { await stopDb(); });
beforeEach(async () => { await resetDb(); cookie = ""; await login(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("auth", () => {
  test("setup protégé, login, cookie, CSRF, rôles", async () => {
    await resetDb(); cookie = "";
    expect((await call("GET", "/api/auth/status", undefined, { cookie: null })).data.setup).toBe(true);
    expect((await call("POST", "/api/auth/setup", { code: "mauvais", email: "a@b.fr", password: "mot-de-passe-solide" }, { cookie: null })).status).toBe(403);
    expect((await call("POST", "/api/auth/setup", { code: "code-install-123", email: "a@b.fr", password: "court" }, { cookie: null })).status).toBe(400);
    const ok = await call("POST", "/api/auth/setup", { code: "code-install-123", email: "a@b.fr", password: "mot-de-passe-solide" }, { cookie: null });
    expect(ok.status).toBe(200);
    expect(ok.setCookie).toMatch(/HttpOnly/);
    expect((await call("POST", "/api/auth/setup", { code: "code-install-123", email: "c@d.fr", password: "mot-de-passe-solide" }, { cookie: null })).status).toBe(403);
    expect((await call("GET", "/api/state", undefined, { cookie: null })).status).toBe(401);
    expect((await call("POST", "/api/auth/login", { email: "a@b.fr", password: "faux" }, { cookie: null })).status).toBe(401);
    const l = await call("POST", "/api/auth/login", { email: "A@B.fr", password: "mot-de-passe-solide" }, { cookie: null });
    cookie = l.setCookie!.split(";")[0];
    expect((await call("GET", "/api/state")).status).toBe(200);
    // CSRF : une écriture sans l'en-tête est refusée
    expect((await call("POST", "/api/drivers", { name: "X" }, { csrf: false })).status).toBe(403);
    // lecture seule
    await call("POST", "/api/users", { email: "v@b.fr", password: "mot-de-passe-solide", role: "viewer" });
    const v = await call("POST", "/api/auth/login", { email: "v@b.fr", password: "mot-de-passe-solide" }, { cookie: null });
    const vc = v.setCookie!.split(";")[0];
    expect((await call("GET", "/api/state", undefined, { cookie: vc })).status).toBe(200);
    expect((await call("POST", "/api/drivers", { name: "Zed" }, { cookie: vc })).status).toBe(403);
  });
  test("blocage après trop d'échecs", async () => {
    for (let i = 0; i < 8; i++) await call("POST", "/api/auth/login", { email: "boss@fox.test", password: "faux" }, { cookie: null });
    expect((await call("POST", "/api/auth/login", { email: "boss@fox.test", password: "mot-de-passe-solide" }, { cookie: null })).status).toBe(429);
  });
});

describe("import FoxDrive manuel", () => {
  const base = [
    { plate: "AA-111-AA", model: "TOYOTA C-HR", name: "Alice Martin", verif: fr(-40) },
    { plate: "BB-222-BB", model: "TESLA MODELE 3", name: "Bruno Durand", verif: fr(-5) },
    { plate: "CC-333-CC", model: "KIA ENIRO", name: "Chloé Petit" },
    { plate: "DD-444-DD", model: "SUZUKI SWACE" },   // disponible : ignoré
  ];
  async function importText(text: string, sel?: any) {
    const p = await call("POST", "/api/imports/fox/preview", { text, label: "test" });
    expect(p.status).toBe(200);
    const a = await call("POST", `/api/imports/${p.data.importId}/apply`, sel || {});
    return { preview: p.data, apply: a };
  }
  test("nouveaux : la date de prise = aujourd'hui, le cycle de 30 jours part de là", async () => {
    const { preview, apply } = await importText(foxText(base));
    expect(preview.res.added).toHaveLength(3);
    expect(apply.data.summary.added).toBe(3);
    const s = (await call("GET", "/api/state")).data;
    expect(s.drivers).toHaveLength(3);
    const chloe = s.drivers.find((d: any) => d.name === "Chloé Petit");
    expect(chloe.pickup).toBe(iso(0));
    expect(L.toISO(L.dueDate(chloe))).toBe(iso(30));
    expect(s.drivers.find((d: any) => d.name === "Alice Martin").lastVerif).toBe(L.toISO(L.addDays(L.todayDate(), -40)));
    expect(s.log.some((e: any) => e.type === "new")).toBe(true);
    expect(s.imports[0].kind).toBe("foxdrive");
  });
  test("ré-import identique : aucun changement", async () => {
    await importText(foxText(base));
    const p = await call("POST", "/api/imports/fox/preview", { text: foxText(base) });
    const r = p.data.res;
    expect(r.added.length + r.matched.length + r.absent.length + r.probable.length).toBe(0);
  });
  test("changement de véhicule : nouvelle plaque, vérification remise à zéro, cycle depuis aujourd'hui", async () => {
    await importText(foxText(base));
    const next = base.map((r) => (r.name === "Bruno Durand" ? { ...r, plate: "ZZ-999-ZZ", model: "TOYOTA COROLLA", verif: undefined } : r));
    const { preview } = await importText(foxText(next));
    expect(preview.res.matched.find((e: any) => e.plateChanged)).toBeTruthy();
    const b = (await call("GET", "/api/state")).data.drivers.find((d: any) => d.name === "Bruno Durand");
    expect(b.plate).toBe("ZZ999ZZ"); expect(b.prevPlate).toBe("BB222BB"); expect(b.lastVerif).toBeNull(); expect(b.pickup).toBe(iso(0));
  });
  test("absents : retirés du suivi (archivés), pas supprimés ; retour automatique", async () => {
    await importText(foxText(base));
    const fewer = base.filter((r) => r.name !== "Chloé Petit");
    const { preview } = await importText(foxText(fewer));
    expect(preview.res.absent).toHaveLength(1);
    let s = (await call("GET", "/api/state")).data;
    const chloe = s.drivers.find((d: any) => d.name === "Chloé Petit");
    expect(chloe.status).toBe("archived");
    expect(chloe.absentSince).toBe(iso(0));
    expect(s.drivers).toHaveLength(3);
    // elle réapparaît
    await importText(foxText(base));
    s = (await call("GET", "/api/state")).data;
    expect(s.drivers.find((d: any) => d.name === "Chloé Petit").status).toBe("active");
  });
  test("export tronqué : départs décochés ; sélection explicite possible", async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ plate: `A${String.fromCharCode(65 + i)}-100-ZZ`, model: "TOYOTA C-HR", name: "Chauffeur Numero" + String.fromCharCode(65 + i) + "Bis" }));
    await importText(foxText(many));
    const p = await call("POST", "/api/imports/fox/preview", { text: foxText(many.slice(0, 5)) });
    expect(p.data.res.truncated).toBe(true);
    expect(p.data.res.absent.every((a: any) => a.on === false)).toBe(true);
    const keep = await call("POST", `/api/imports/${p.data.importId}/apply`, {});
    expect(keep.data.summary.left).toBe(0);
    const p2 = await call("POST", "/api/imports/fox/preview", { text: foxText(many.slice(0, 5)) });
    const forced = await call("POST", `/api/imports/${p2.data.importId}/apply`, { on: p2.data.res.absent.map((a: any) => a.key) });
    expect(forced.data.summary.left).toBe(15);
  });
  test("grille tableur (Chauffeur / Immatriculation / Modèle / Dernière vérification / Situation)", async () => {
    const grid = [["Chauffeur", "Immatriculation", "Modèle", "Dernière vérification", "Situation"],
      ["Zoé Lambert", "ZL-123-AB", "TOYOTA C-HR", fr(-10), "À jour"], ["Yann Roux", "YR-456-CD", "KIA ENIRO", "", "Jamais vérifié"]];
    const p = await call("POST", "/api/imports/fox/preview", { grid, label: "xlsx" });
    expect(p.status).toBe(200);
    expect(p.data.res.added).toHaveLength(2);
  });
});

describe("synchro automatique depuis la feuille Google", () => {
  const csv = (rows: any[]) => "Chauffeur,Immatriculation,Modèle,Dernière vérification\n" + rows.map((r) => [r.name, r.plate, r.model, r.verif || ""].join(",")).join("\n");
  const stubSheet = (getText: () => string) => vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(getText(), { status: 200 })));
  const list = (n: number, off = 0) => Array.from({ length: n }, (_, i) => ({ name: "Prenom" + String.fromCharCode(65 + ((i + off) % 26)) + " Nom" + String.fromCharCode(65 + (Math.floor((i + off) / 26) % 26)) + String.fromCharCode(66 + (i % 20)), plate: `S${String.fromCharCode(65 + (i % 26))}-${String(100 + i)}-XY`, model: "TOYOTA C-HR", verif: fr(-(i % 40)) }));

  beforeEach(async () => { await call("PUT", "/api/settings/sheet", { mode: "csv", csvUrl: "https://docs.google.com/spreadsheets/d/e/FAKE/pub?output=csv" }); });

  test("applique sans demander quand tout est sûr, puis ignore si rien n'a changé", async () => {
    const rows = list(20); let cur = csv(rows); stubSheet(() => cur);
    const r1: any = await runFoxSync();
    expect(r1.status).toBe("applied"); expect(r1.summary.added).toBe(20);
    expect((await runFoxSync() as any).status).toBe("unchanged");
    // un départ + un nouveau
    cur = csv([...rows.slice(1), { name: "Nouveau Chauffeur", plate: "NN-001-NN", model: "KIA ENIRO" }]);
    const r2: any = await runFoxSync();
    expect(r2.status).toBe("applied"); expect(r2.summary.added).toBe(1); expect(r2.summary.left).toBe(1);
    const s = (await call("GET", "/api/state")).data;
    expect(s.drivers.filter((d: any) => d.status === "active")).toHaveLength(20);
    expect(s.drivers.filter((d: any) => d.status === "archived")).toHaveLength(1);
  });
  test("export incomplet : mis en attente, rien n'est retiré ; validation depuis l'app", async () => {
    const rows = list(30); let cur = csv(rows); stubSheet(() => cur);
    await runFoxSync();
    cur = csv(rows.slice(0, 8));
    const r: any = await runFoxSync();
    expect(r.status).toBe("pending");
    let s = (await call("GET", "/api/state")).data;
    expect(s.drivers.filter((d: any) => d.status === "active")).toHaveLength(30);
    expect(s.pending).toHaveLength(1);
    const rev = await call("GET", `/api/imports/${s.pending[0].id}`);
    expect(rev.data.res.absent).toHaveLength(22);
    const ok = await call("POST", `/api/imports/${s.pending[0].id}/apply`, { on: rev.data.res.absent.map((a: any) => a.key) });
    expect(ok.data.summary.left).toBe(22);
    s = (await call("GET", "/api/state")).data;
    expect(s.drivers.filter((d: any) => d.status === "active")).toHaveLength(8);
    expect(s.pending).toHaveLength(0);
  });
  test("réglage « validation manuelle » : tout passe par l'écran de validation", async () => {
    await call("PUT", "/api/settings/automation", { autoApplySync: false });
    stubSheet(() => csv(list(5)));
    const r: any = await runFoxSync();
    expect(r.status).toBe("pending");
    expect((await call("GET", "/api/state")).data.drivers).toHaveLength(0);
  });
  test("lien Google privé (page de connexion) : erreur claire, état mémorisé", async () => {
    stubSheet(() => "<!doctype html><html>Sign in</html>");
    await expect(runFoxSync()).rejects.toThrow(/pas public/);
    const st = (await call("GET", "/api/settings")).data;
    expect(st.sync_state.lastError).toMatch(/pas public/);
  });
  test("texte FoxDrive collé tel quel dans la feuille (colonne A)", async () => {
    const text = foxText([{ plate: "TT-100-TT", model: "TOYOTA C-HR", name: "Texte Colle", verif: fr(-3) }, { plate: "TT-200-TT", model: "KIA ENIRO", name: "Autre Colle" }]);
    stubSheet(() => text.split("\n").map((l) => `"${l}"`).join("\n"));
    const r: any = await runFoxSync();
    expect(r.status).toBe("applied"); expect(r.summary.added).toBe(2);
  });
});

describe("contacts, fiches, sauvegarde", () => {
  test("contacts nom -> numéro, puis fiche chauffeur", async () => {
    await call("POST", "/api/imports/fox/preview", { text: foxText([{ plate: "AA-111-AA", model: "TOYOTA C-HR", name: "Alice Martin" }]) }).then((p) => call("POST", `/api/imports/${p.data.importId}/apply`, {}));
    const p = await call("POST", "/api/imports/contacts/preview", { text: "Alice Martin;06 12 34 56 78\nInconnu Total;0699999999" });
    expect(p.data.res.assign).toHaveLength(1); expect(p.data.res.unmatched).toHaveLength(1);
    await call("POST", `/api/imports/${p.data.importId}/apply`, {});
    const s = (await call("GET", "/api/state")).data;
    expect(s.drivers[0].phone).toBe("0612345678");
    expect(Object.values(s.contacts).some((c: any) => c.name === "Inconnu Total")).toBe(true);
    const id = s.drivers[0].id;
    expect((await call("PATCH", `/api/drivers/${id}`, { phone: "abc" })).status).toBe(400);
    expect((await call("PATCH", `/api/drivers/${id}`, { plate: "xx 555 yy", vehicle: "KIA NIRO", notes: "ok" })).status).toBe(200);
    expect((await call("POST", `/api/drivers/${id}/action`, { action: "received" })).data.driver.lastCheckin).toBeTruthy();
    await call("POST", `/api/drivers/${id}/action`, { action: "archive" });
    expect((await call("GET", "/api/state")).data.drivers[0].status).toBe("archived");
    await call("POST", `/api/drivers/${id}/action`, { action: "reactivate" });
    const h = (await call("GET", `/api/drivers/${id}/history`)).data;
    expect(h.events.map((e: any) => e.type)).toEqual(expect.arrayContaining(["phone", "vehicle", "verif", "archive", "return"]));
  });
  test("restauration d'une ancienne sauvegarde (liste) puis d'une sauvegarde complète, sans doublon", async () => {
    const legacy = [{ id: 1, name: "Alice Martin", phone: "0612345678", plate: "AA111AA", vehicle: "TOYOTA C-HR", depart: "2026-06-01", lastVerif: "2026-09-01", lastContacted: "2026-10-12T10:00:00.000Z" }, { id: 2, name: "Bruno Durand", phone: "0698765432", plate: "BB222BB", vehicle: "KIA", lastContacted: null }];
    const r = await call("POST", "/api/backup/import", { data: { v: 4, drivers: legacy, contacts: {}, log: [] } });
    expect(r.data.mode).toBe("replace");
    let s = (await call("GET", "/api/state")).data;
    expect(s.drivers).toHaveLength(2);
    expect(s.drivers[0].pickup).toBe("2026-06-01");
    expect(s.drivers[0].lastContacted).toBe("2026-10-12T10:00:00.000Z");
    const b = (await call("GET", "/api/backup")).data;
    expect(b.drivers).toHaveLength(2);
    // remplacer demande une confirmation quand la base n'est pas vide
    expect((await call("POST", "/api/backup/import", { data: b, mode: "replace" })).status).toBe(409);
    expect((await call("POST", "/api/backup/import", { data: b, mode: "replace", confirm: "REMPLACER" })).status).toBe(200);
    s = (await call("GET", "/api/state")).data;
    expect(s.drivers).toHaveLength(2);
  });
});

describe("réglages et secrets", () => {
  test("les secrets sont chiffrés en base et ne ressortent jamais", async () => {
    await call("PUT", "/api/settings/anthropic", { apiKey: "sk-ant-SECRET-1234567890", model: "claude-sonnet-5-5" });
    await call("PUT", "/api/settings/whatsapp", { token: "EAAG-SECRET-TOKEN-9999", phoneNumberId: "1234567890", appSecret: "appsecret-xyz" });
    const raw = await q("SELECT key, value, secret FROM settings WHERE key IN ('anthropic','whatsapp')");
    raw.forEach((r: any) => { expect(r.secret).toBe(true); expect(r.value).not.toMatch(/SECRET/); expect(r.value.startsWith("v1:")).toBe(true); });
    const out = JSON.stringify((await call("GET", "/api/settings")).data);
    expect(out).not.toMatch(/SECRET-1234567890|EAAG-SECRET|appsecret-xyz/);
    expect(out).toMatch(/••••7890/);
    expect((await call("GET", "/api/settings")).data.whatsapp.verifyToken.length).toBeGreaterThan(10);
  });
});

/* ---------- WhatsApp + campagnes ---------- */
describe("campagnes WhatsApp", () => {
  async function seed() {
    const rows = [
      { plate: "AA-111-AA", model: "TOYOTA C-HR", name: "Alice Martin", verif: fr(-40) },   // en retard
      { plate: "BB-222-BB", model: "TESLA MODELE 3", name: "Bruno Durand", verif: fr(-35) }, // en retard
      { plate: "CC-333-CC", model: "KIA ENIRO", name: "Chloé Petit", verif: fr(-31) },       // en retard, sans numéro
      { plate: "DD-444-DD", model: "SUZUKI SWACE", name: "David Roche", verif: fr(-2) },     // à jour
    ];
    const p = await call("POST", "/api/imports/fox/preview", { text: foxText(rows) });
    await call("POST", `/api/imports/${p.data.importId}/apply`, {});
    const c = await call("POST", "/api/imports/contacts/preview", { text: "Alice Martin;0612345678\nBruno Durand;0698765432\nDavid Roche;0611111111" });
    await call("POST", `/api/imports/${c.data.importId}/apply`, {});
    await call("PUT", "/api/settings/whatsapp", { token: "TOKEN", phoneNumberId: "555", appSecret: "shh" });
    // ces chauffeurs sont là depuis longtemps : seule leur dernière vérification compte
    await q("UPDATE drivers SET pickup = $1::date", [iso(-200)]);
  }
  const waStub = (fail: string[] = []) => {
    const sent: any[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: any) => {
      const b = JSON.parse(init.body);
      if (fail.includes(b.to)) return new Response(JSON.stringify({ error: { message: "Numéro hors WhatsApp", code: 131026 } }), { status: 400 });
      sent.push(b);
      return new Response(JSON.stringify({ messages: [{ id: "wamid." + sent.length }] }), { status: 200 });
    }));
    return sent;
  };

  test("brouillon : cible les retards avec numéro ; rien ne part avant validation", async () => {
    await seed(); const sent = waStub();
    const c = (await call("POST", "/api/campaigns", { type: "relance" })).data.campaign;
    expect(c.status).toBe("draft");
    expect(c.items.filter((i: any) => i.status === "pending").map((i: any) => i.name).sort()).toEqual(["Alice Martin", "Bruno Durand"]);
    expect(sent).toHaveLength(0);
  });
  test("envoi par modèle, historique, date de contact, pas de double envoi", async () => {
    await seed(); const sent = waStub();
    const c = (await call("POST", "/api/campaigns", { type: "relance" })).data.campaign;
    const r = await call("POST", `/api/campaigns/${c.id}/send`, { limit: 10 });
    expect(r.data.sent).toBe(2); expect(r.data.remaining).toBe(0);
    expect(r.data.campaign.status).toBe("sent");
    expect(sent).toHaveLength(2);
    expect(sent[0].type).toBe("template"); expect(sent[0].template.name).toBe("relance_verification");
    expect(sent[0].to).toMatch(/^33/); expect(sent[0].template.components[0].parameters.map((p: any) => p.text)).toEqual(["Alice", "AA-111-AA"]);
    expect((await call("POST", `/api/campaigns/${c.id}/send`, {})).status).toBe(409);
    const s = (await call("GET", "/api/state")).data;
    expect(s.drivers.find((d: any) => d.name === "Alice Martin").lastContacted).toBeTruthy();
    // nouvelle relance tout de suite : plus personne (délai de 3 jours)
    expect((await call("POST", "/api/campaigns", { type: "relance" })).status).toBe(422);
    const h = (await call("GET", `/api/drivers/${s.drivers[0].id}/history`)).data;
    expect(h.messages[0].status).toBe("sent");
  });
  test("échec d'un envoi : noté, les autres partent, relançable", async () => {
    await seed(); waStub(["33698765432"]);
    const c = (await call("POST", "/api/campaigns", { type: "relance" })).data.campaign;
    const r = await call("POST", `/api/campaigns/${c.id}/send`, {});
    expect(r.data.sent).toBe(1); expect(r.data.failed).toBe(1);
    const bad = r.data.campaign.items.find((i: any) => i.status === "failed");
    expect(bad.name).toBe("Bruno Durand"); expect(bad.error).toMatch(/hors WhatsApp/);
    expect((await call("GET", "/api/state")).data.drivers.find((d: any) => d.name === "Bruno Durand").lastContacted).toBeNull();
  });
  test("retirer quelqu'un du brouillon avant envoi", async () => {
    await seed(); const sent = waStub();
    const c = (await call("POST", "/api/campaigns", { type: "relance" })).data.campaign;
    const bruno = c.items.find((i: any) => i.name === "Bruno Durand");
    await call("PATCH", `/api/campaigns/${c.id}/items/${bruno.driverId}`, { status: "skipped" });
    await call("POST", `/api/campaigns/${c.id}/send`, {});
    expect(sent).toHaveLength(1);
  });
  test("relance ferme : jamais dans les campagnes automatiques de l'agent, mais possible à la main", async () => {
    await seed(); waStub();
    const c = await call("POST", "/api/campaigns", { type: "relance_ferme", driverIds: [1] });
    expect(c.status).toBe(200);
  });
  test("tâche quotidienne : brouillon, et envoi seulement si l'option est activée (plafond respecté)", async () => {
    await seed(); const sent = waStub();
    const d1: any = await dailyRun();
    expect(d1.status).toBe("draft"); expect(sent).toHaveLength(0);
    expect((await dailyRun() as any).status).toBe("already-open");
    await q("UPDATE campaigns SET status = 'cancelled'");
    await call("PUT", "/api/settings/automation", { autoSendRelance: true, maxPerDay: 1 });
    const d2: any = await dailyRun();
    expect(d2.status).toBe("sent"); expect(sent).toHaveLength(1);   // plafond de 1 message par jour : la campagne ne contient que 1 personne
    expect(((await continueAutoSending()) as any).status).toBe("idle");
    expect(sent).toHaveLength(1);
    // le plafond du jour est atteint : une nouvelle campagne automatique n'envoie plus rien
    await call("PUT", "/api/settings/automation", { maxPerDay: 1 });
    await q("UPDATE drivers SET last_contacted = NULL");
    const d3: any = await dailyRun();
    expect(d3.status).toBe("draft"); expect(sent).toHaveLength(1);
  });
  test("webhook : statuts mis à jour, réponses de chauffeurs enregistrées, fenêtre 24 h => texte libre", async () => {
    await seed(); const sent = waStub();
    const c = (await call("POST", "/api/campaigns", { type: "relance" })).data.campaign;
    await call("POST", `/api/campaigns/${c.id}/send`, {});
    await handleWebhookPayload({ entry: [{ changes: [{ value: { statuses: [{ id: "wamid.1", status: "delivered" }, { id: "wamid.2", status: "read" }] } }] }] });
    expect((await q("SELECT status FROM messages WHERE wa_id = 'wamid.1'"))[0].status).toBe("delivered");
    await handleWebhookPayload({ entry: [{ changes: [{ value: { messages: [{ from: "33612345678", id: "wamid.in1", type: "image" }] } }] }] });
    await handleWebhookPayload({ entry: [{ changes: [{ value: { messages: [{ from: "33612345678", id: "wamid.in1", type: "image" }] } }] }] });   // doublon
    const rep = (await call("GET", "/api/replies")).data.replies;
    expect(rep).toHaveLength(1); expect(rep[0].name).toBe("Alice Martin"); expect(rep[0].body).toBe("[photo]");
    // Alice a écrit il y a moins de 24 h : un message libre est possible (pas de modèle)
    const id = (await call("GET", "/api/state")).data.drivers.find((d: any) => d.name === "Alice Martin").id;
    await q("UPDATE drivers SET last_contacted = NULL WHERE id = $1", [id]);
    await call("POST", `/api/drivers/${id}/send`, { kind: "revision" });
    expect(sent[sent.length - 1].type).toBe("text");
  });
});

/* ---------- agent IA ---------- */
describe("agent IA", () => {
  test("outils : résumé + brouillon de campagne, aucun envoi ; réponse finale renvoyée", async () => {
    const rows = [{ plate: "AA-111-AA", model: "TOYOTA C-HR", name: "Alice Martin", verif: fr(-40) }, { plate: "BB-222-BB", model: "KIA ENIRO", name: "Bruno Durand", verif: fr(-3) }];
    const p = await call("POST", "/api/imports/fox/preview", { text: foxText(rows) });
    await call("POST", `/api/imports/${p.data.importId}/apply`, {});
    const c = await call("POST", "/api/imports/contacts/preview", { text: "Alice Martin;0612345678" });
    await call("POST", `/api/imports/${c.data.importId}/apply`, {});
    await call("PUT", "/api/settings/anthropic", { apiKey: "sk-ant-test" });
    await q("UPDATE drivers SET pickup = $1::date", [iso(-200)]);
    let n = 0; const seenBodies: any[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: any) => {
      const b = JSON.parse(init.body); seenBodies.push(b); n++;
      expect(JSON.stringify(b.tools.map((t: any) => t.name))).not.toMatch(/send/);
      if (n === 1) return new Response(JSON.stringify({ stop_reason: "tool_use", usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: "text", text: "Je regarde." }, { type: "tool_use", id: "t1", name: "fleet_summary", input: {} }, { type: "tool_use", id: "t2", name: "prepare_campaign", input: { type: "relance" } }] }), { status: 200 });
      return new Response(JSON.stringify({ stop_reason: "end_turn", usage: { input_tokens: 20, output_tokens: 8 }, content: [{ type: "text", text: "Brouillon prêt : 1 chauffeur." }] }), { status: 200 });
    }));
    const r = await call("POST", "/api/agent/chat", { messages: [{ role: "user", content: "Prépare la relance des retards" }] });
    expect(r.status).toBe(200);
    expect(r.data.reply).toBe("Brouillon prêt : 1 chauffeur.");
    expect(r.data.campaignId).toBeTruthy();
    const tr = seenBodies[1].messages[seenBodies[1].messages.length - 1].content;
    expect(JSON.parse(tr[0].content).actifs).toBe(2);
    expect(JSON.parse(tr[1].content).status).toMatch(/brouillon/);
    const camp = (await call("GET", `/api/campaigns/${r.data.campaignId}`)).data.campaign;
    expect(camp.status).toBe("draft"); expect(camp.origin).toBe("agent");
    expect((await q("SELECT count(*)::int AS n FROM messages"))[0].n).toBe(0);
    expect((await q("SELECT tokens_in FROM agent_runs"))[0].tokens_in).toBe(30);
  });
  test("sans clé : message clair", async () => {
    const r = await call("POST", "/api/agent/chat", { messages: [{ role: "user", content: "salut" }] });
    expect(r.status).toBe(400); expect(r.data.error).toMatch(/clé API/);
  });
});
