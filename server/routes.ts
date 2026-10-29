import "./env.ts";
import { q } from "./db.ts";
import * as L from "../public/lib.js";
import { HttpError, randomToken } from "./crypto.ts";
import { addUser, changePassword, COOKIE, currentUser, login, sessionCookie, setupAdmin, usersExist } from "./auth.ts";
import { clientIp, json, match, pathExists, readBody, route, type Ctx } from "./http.ts";
import { loadDrivers, loadEvents, loadStateView, withState } from "./repo.ts";
import { DEFAULTS, getSetting, publicSettings, setSetting } from "./settings.ts";
import { applyContactsImport, applyFoxImport, previewContacts, previewFox, rejectImport, runContactsSync, runFoxSync } from "./sync.ts";
import { fetchFoxFromSource, parseFoxGrid } from "./sheets.ts";
import { TEMPLATE_BODIES, sendToDriver, waConfig } from "./whatsapp.ts";
import { cancelCampaign, createCampaign, getCampaign, listCampaigns, messagesFor, recentReplies, relanceTargets, sendCampaignBatch, setItemStatus } from "./campaigns.ts";
import { agentConfig, callClaude, chat } from "./agent.ts";

const bad = (m: string, s = 400) => { throw new HttpError(s, m); };
const isoDay = (v: any) => (v === null || v === "" ? null : /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : bad("Date invalide (AAAA-MM-JJ attendu)."));

/* ================= santé / auth ================= */
route("GET", "/api/health", "none", async () => { await q("SELECT 1"); return { ok: true, time: new Date().toISOString() }; });

route("GET", "/api/auth/status", "none", async ({ req }) => {
  const user = await currentUser(req);
  return { setup: !(await usersExist()), user };
});
route("POST", "/api/auth/setup", "none", async ({ body, url }) => {
  const u = await setupAdmin(body);
  const { token } = await login(u.email, body.password, "");
  return new Response(JSON.stringify({ user: u }), { headers: { "content-type": "application/json", "set-cookie": sessionCookie(token, url.protocol === "https:") } });
});
route("POST", "/api/auth/login", "none", async ({ body, url, req }) => {
  const { user, token } = await login(body.email, body.password, clientIp(req));
  return new Response(JSON.stringify({ user }), { headers: { "content-type": "application/json", "set-cookie": sessionCookie(token, url.protocol === "https:") } });
});
route("POST", "/api/auth/logout", "none", async ({ url }) =>
  new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json", "set-cookie": sessionCookie(null, url.protocol === "https:") } }));
route("POST", "/api/me/password", "user", async ({ user, body }) => { await changePassword(user.id, body.oldPassword, body.newPassword); return { ok: true }; });
route("GET", "/api/users", "admin", async () => ({ users: await q("SELECT id, email, name, role FROM users ORDER BY id") }));
route("POST", "/api/users", "admin", async ({ body }) => ({ user: await addUser(body) }));
route("DELETE", "/api/users/:id", "admin", async ({ params, user }) => {
  if (Number(params.id) === user.id) bad("Tu ne peux pas supprimer ton propre compte.");
  await q("DELETE FROM users WHERE id = $1", [Number(params.id)]); return { ok: true };
});

/* ================= état ================= */
async function config() {
  const s = await publicSettings();
  return { whatsapp: s.whatsapp.set, agent: s.anthropic.set, sheet: !!(s.sheet.mode === "api" ? (s.google_sa.set && s.sheet.spreadsheetId) : s.sheet.csvUrl), sync: s.sync_state, automation: s.automation };
}
route("GET", "/api/state", "user", async () => ({ ...(await loadStateView()), config: await config() }));

/* ================= chauffeurs ================= */
const FIELD_LABELS: Record<string, string> = { name: "Nom", vehicle: "Véhicule", manager: "Responsable", pickup: "Prise du véhicule", lastVerif: "Dernière vérification", lastCheckin: "Vérification reçue", notes: "Notes" };

route("POST", "/api/drivers", "admin", async ({ body }) => {
  const name = String(body.name || "").trim();
  const plate = L.normPlate(body.plate);
  if (!name) bad("Le nom est obligatoire.");
  let phone = "";
  if (body.phone) { const np = L.normPhone(body.phone); if (!np.ok) bad("Numéro de téléphone invalide."); phone = np.phone; }
  return await withState((S) => {
    const key = L.nameKey(name);
    if (S.drivers.some((d) => L.nameKey(d.name) === key && L.isActive(d))) bad("Un chauffeur actif porte déjà ce nom.", 409);
    const d: any = { id: Math.max(0, ...S.drivers.map((x) => x.id)) + 1, name, phone, plate, vehicle: String(body.vehicle || "").trim(), manager: "", pickup: isoDay(body.pickup) || L.toISO(new Date()), pickupEstimated: !body.pickup, lastVerif: isoDay(body.lastVerif) ?? null, lastCheckin: null, lastContacted: null, status: "active", absentSince: null, source: "manuel", notes: "" };
    S.drivers.push(d);
    L.pushLog(S, "new", d, "Chauffeur ajouté à la main · " + L.fmtPlate(plate));
    return { driver: d };
  });
});

route("PATCH", "/api/drivers/:id", "admin", async ({ params, body }) => {
  const id = Number(params.id);
  return await withState((S) => {
    const d = S.drivers.find((x) => x.id === id) || bad("Chauffeur introuvable.", 404);
    const notes: string[] = [];
    if ("phone" in body) {
      const raw = String(body.phone || "").trim();
      if (!raw) { if (d.phone) { notes.push("numéro supprimé"); d.phone = ""; } }
      else { const np = L.normPhone(raw); if (!np.ok) bad("Numéro de téléphone invalide."); if (np.phone !== d.phone) { L.pushLog(S, "phone", d, d.phone ? "Numéro modifié : " + L.fmtPhone(d.phone) + " → " + L.fmtPhone(np.phone) : "Numéro ajouté : " + L.fmtPhone(np.phone)); d.phone = np.phone; S.contacts[L.nameKey(d.name)] = { name: d.name, phone: np.phone }; } }
    }
    if ("plate" in body) {
      const p = L.normPlate(body.plate);
      if (p !== d.plate) { d.prevPlate = d.plate || undefined; L.pushLog(S, "vehicle", d, (d.plate ? L.fmtPlate(d.plate) : "—") + " → " + (p ? L.fmtPlate(p) : "—") + " (modifié à la main)", { from: d.plate, to: p }); d.plate = p; }
    }
    for (const k of ["name", "vehicle", "manager", "notes"] as const) {
      if (k in body) { const v = String(body[k] ?? "").trim(); if (k === "name" && !v) bad("Le nom est obligatoire."); if (v !== d[k]) { d[k] = v; notes.push(FIELD_LABELS[k] + " modifié"); } }
    }
    for (const k of ["pickup", "lastVerif", "lastCheckin"] as const) {
      if (k in body) { const v = isoDay(body[k]); if ((v || null) !== (d[k] ? String(d[k]).slice(0, 10) : null)) { d[k] = v; if (k === "pickup") d.pickupEstimated = false; notes.push(FIELD_LABELS[k] + " : " + (v || "—")); } }
    }
    if (notes.length) L.pushLog(S, "edit", d, "Modifié à la main : " + notes.join(", "));
    return { driver: d };
  });
});

route("POST", "/api/drivers/:id/action", "admin", async ({ params, body }) => {
  const id = Number(params.id), action = String(body.action || "");
  return await withState((S) => {
    const d = S.drivers.find((x) => x.id === id) || bad("Chauffeur introuvable.", 404);
    const today = L.toISO(new Date());
    switch (action) {
      case "received": d.lastCheckin = new Date().toISOString(); L.pushLog(S, "verif", d, "Vérification reçue (photos + compteur)"); break;
      case "contacted": d.lastContacted = new Date().toISOString(); L.pushLog(S, "contact", d, "Message préparé · " + ((L.MESSAGE_TYPES.find((t: any) => t.key === body.kind) as any)?.label || "WhatsApp")); break;
      case "archive": d.status = "archived"; d.absentSince = today; L.pushLog(S, "archive", d, "Départ confirmé"); break;
      case "reactivate": d.status = "active"; d.absentSince = null; L.pushLog(S, "return", d, "Remis dans le suivi"); break;
      default: bad("Action inconnue.");
    }
    return { driver: d };
  });
});

route("GET", "/api/drivers/:id/history", "user", async ({ params }) => {
  const id = Number(params.id);
  return { events: await loadEvents(60, id), messages: await messagesFor(id, 60) };
});

route("POST", "/api/drivers/:id/send", "admin", async ({ params, body }) => {
  const d = (await loadDrivers()).find((x) => x.id === Number(params.id)) || bad("Chauffeur introuvable.", 404);
  if (!L.isActive(d)) bad("Ce chauffeur n'est plus dans le suivi.", 409);
  const kind = String(body.kind || "relance");
  if (!L.MESSAGE_TYPES.some((t: any) => t.key === kind)) bad("Type de message inconnu.");
  const r = await sendToDriver(d, kind);
  if (!r.ok) throw new HttpError(502, r.error || "Envoi impossible.");
  return r;
});

/* ================= imports / synchro ================= */
function parseUpload(body: any) {
  if (typeof body.text === "string" && body.text.trim()) return L.parseFoxText(body.text);
  if (Array.isArray(body.grid)) return parseFoxGrid(body.grid);
  return bad("Rien à analyser : colle le texte FoxDrive ou choisis un fichier.");
}
route("POST", "/api/imports/fox/preview", "admin", async ({ body }) => previewFox(parseUpload(body), String(body.label || "import manuel").slice(0, 120)));
route("POST", "/api/imports/contacts/preview", "admin", async ({ body }) => {
  let entries: any[] = [];
  if (typeof body.text === "string") entries = /BEGIN:VCARD/i.test(body.text) ? L.contactsFromVcf(body.text) : L.contactsFromText(body.text);
  else if (Array.isArray(body.grid)) entries = L.contactsFromGrid(body.grid);
  return previewContacts(entries, String(body.label || "contacts").slice(0, 120));
});
route("GET", "/api/imports/:id", "admin", async ({ params }) => {
  const [row] = await q("SELECT id, kind, source, status, payload, reason FROM imports WHERE id = $1", [Number(params.id)]);
  if (!row || !["preview", "pending"].includes(row.status)) bad("Cet import n'existe plus.", 404);
  if (row.kind === "foxdrive") return { importId: Number(row.id), kind: row.kind, label: row.source, reason: row.reason, format: row.payload.format, ignored: row.payload.ignored, res: await withState((S) => L.reconcileFox(S, row.payload)) };
  return { importId: Number(row.id), kind: row.kind, label: row.source, res: await withState((S) => L.reconcileContacts(S, row.payload)) };
});
route("POST", "/api/imports/:id/apply", "admin", async ({ params, body }) => {
  const [row] = await q("SELECT kind FROM imports WHERE id = $1", [Number(params.id)]);
  if (!row) bad("Cet import n'existe plus.", 404);
  const sel = { on: body.on, off: body.off, assign: body.assign };
  return row.kind === "foxdrive" ? { summary: await applyFoxImport(Number(params.id), sel) } : { summary: await applyContactsImport(Number(params.id), sel) };
});
route("POST", "/api/imports/:id/reject", "admin", async ({ params }) => { await rejectImport(Number(params.id)); return { ok: true }; });

route("POST", "/api/sync/run", "admin", async ({ body }) => {
  const fox = await runFoxSync({ force: !!body.force, origin: "manual" });
  let contacts: any = { status: "skipped" };
  try { contacts = await runContactsSync(); } catch (e: any) { contacts = { status: "error", error: e?.message || String(e) }; }
  return { fox, contacts };
});

/* ================= sauvegarde ================= */
route("GET", "/api/backup", "admin", async () => ({
  app: "fox-drive", v: 5, exportedAt: new Date().toISOString(), drivers: await loadDrivers(), contacts: await withState((S) => S.contacts),
  log: await loadEvents(5000), settings: { sheet: await getSetting("sheet"), automation: await getSetting("automation"), wa_templates: await getSetting("wa_templates") },
}));

route("POST", "/api/backup/import", "admin", async ({ body }) => {
  const nowEmpty = (await loadDrivers()).length === 0;
  const mode = body.mode || (nowEmpty ? "replace" : "merge");
  const src = body.data;
  if (Array.isArray(src)) {   // très ancienne sauvegarde : simple liste de chauffeurs -> fusion par nom
    const r = await withState((S) => { const out = L.mergeLegacyBackup(S, src, { preferBackup: true }); L.pushLog(S, "import", null, "Ancienne sauvegarde fusionnée : " + out.matched + " chauffeurs rapprochés"); return out; });
    return { mode: "merge", ...r };
  }
  if (!src || !Array.isArray(src.drivers)) bad("Fichier de sauvegarde non reconnu.");
  if (mode === "replace") {
    if (!nowEmpty && body.confirm !== "REMPLACER") bad("Confirmation requise pour remplacer toutes les données.", 409);
    await q("DELETE FROM events");
    const n = await withState((S) => {
      S.drivers.length = 0;
      src.drivers.forEach((o: any) => { if (o && o.name) S.drivers.push({ ...L.normalizeDriver(o), notes: o.notes || "" }); });
      S.contacts = {};
      Object.entries(src.contacts || {}).forEach(([k, v]: any) => { if (v?.phone) S.contacts[k] = { name: v.name || k, phone: v.phone }; });
      S.drivers.forEach((d) => { if (d.phone) S.contacts[L.nameKey(d.name)] = { name: d.name, phone: d.phone }; });
      (src.log || []).slice(0, 3000).forEach((e: any) => { if (e && e.type && e.ts) S.log.push({ ...e }); });
      L.pushLog(S, "import", null, "Sauvegarde restaurée : " + S.drivers.length + " chauffeurs");
      return S.drivers.length;
    });
    return { mode, drivers: n };
  }
  const r = await withState((S) => { const out = L.mergeLegacyBackup(S, src.drivers, { preferBackup: false }); L.pushLog(S, "import", null, "Sauvegarde fusionnée : " + out.matched + " chauffeurs rapprochés"); return out; });
  return { mode, ...r };
});

/* ================= réglages ================= */
route("GET", "/api/settings", "admin", async ({ url }) => ({
  ...(await publicSettings()), webhookUrl: url.origin + "/webhooks/whatsapp", templateBodies: TEMPLATE_BODIES,
}));

route("PUT", "/api/settings/:key", "admin", async ({ params, body }) => {
  const key = params.key;
  if (key === "sheet") {
    const cur: any = await getSetting("sheet");
    const next = { ...cur };
    for (const f of ["csvUrl", "contactsCsvUrl", "spreadsheetId", "tab", "contactsTab"]) if (f in body) next[f] = String(body[f] ?? "").trim().slice(0, 600);
    if ("mode" in body) next.mode = body.mode === "api" ? "api" : "csv";
    await setSetting("sheet", next);
  } else if (key === "automation") {
    const cur: any = await getSetting("automation");
    const n = Math.max(1, Math.min(200, parseInt(body.maxPerDay ?? cur.maxPerDay, 10) || 30));
    await setSetting("automation", { autoApplySync: "autoApplySync" in body ? !!body.autoApplySync : cur.autoApplySync, autoSendRelance: "autoSendRelance" in body ? !!body.autoSendRelance : cur.autoSendRelance, dailyDraft: "dailyDraft" in body ? !!body.dailyDraft : cur.dailyDraft, maxPerDay: n });
  } else if (key === "wa_templates") {
    const cur: any = await getSetting("wa_templates");
    for (const t of Object.keys(DEFAULTS.wa_templates)) if (body[t]) {
      const name = String(body[t].name || "").trim(), lang = String(body[t].lang || "fr").trim();
      if (!/^[a-z0-9_]{1,512}$/.test(name)) bad("Nom de modèle invalide (minuscules, chiffres et _ uniquement).");
      cur[t] = { name, lang };
    }
    await setSetting("wa_templates", cur);
  } else if (key === "google_sa") {
    let j: any; try { j = typeof body.json === "string" ? JSON.parse(body.json) : body.json; } catch { bad("Ce n'est pas un fichier JSON valide."); }
    if (!j?.client_email || !j?.private_key) bad("Ce JSON n'est pas une clé de compte de service Google (client_email / private_key manquants).");
    await setSetting("google_sa", { client_email: j.client_email, private_key: j.private_key, project_id: j.project_id });
  } else if (key === "whatsapp") {
    const cur: any = (await getSetting("whatsapp")) || {};
    const next = { ...cur };
    for (const f of ["token", "phoneNumberId", "wabaId", "appSecret"]) if (body[f]) next[f] = String(body[f]).trim();
    if (!next.verifyToken) next.verifyToken = randomToken(18);
    if (body.regenerateVerifyToken) next.verifyToken = randomToken(18);
    await setSetting("whatsapp", next);
  } else if (key === "anthropic") {
    const cur: any = (await getSetting("anthropic")) || {};
    const next = { ...cur };
    if (body.apiKey) next.apiKey = String(body.apiKey).trim();
    if (body.model) next.model = String(body.model).trim();
    await setSetting("anthropic", next);
  } else bad("Réglage inconnu.", 404);
  return publicSettings();
});

route("POST", "/api/settings/test/:what", "admin", async ({ params }) => {
  if (params.what === "sheet") {
    const { parsed, label } = await fetchFoxFromSource();
    return { ok: true, message: label + " : " + parsed.rows.length + " chauffeur(s) en location lu(s)" + (parsed.ignored?.other ? ", " + parsed.ignored.other + " ligne(s) ignorée(s)" : "") + ".", sample: parsed.rows.slice(0, 3).map((r: any) => r.name + " · " + L.fmtPlate(r.plate)) };
  }
  if (params.what === "whatsapp") {
    const cfg = await waConfig(); if (!cfg) bad("WhatsApp n'est pas configuré.");
    const r = await fetch(`https://graph.facebook.com/v21.0/${cfg.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`, { headers: { authorization: "Bearer " + cfg.token }, signal: AbortSignal.timeout(15000) });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) bad("WhatsApp : " + (j?.error?.message || r.status), 502);
    return { ok: true, message: "Numéro " + (j.display_phone_number || "") + " · " + (j.verified_name || "") + (j.quality_rating ? " · qualité " + j.quality_rating : "") };
  }
  if (params.what === "anthropic") {
    const cfg = await agentConfig(); if (!cfg) bad("Clé API Claude absente.");
    const j = await callClaude(cfg, { max_tokens: 16, messages: [{ role: "user", content: "Réponds uniquement : ok" }] });
    return { ok: true, message: "Claude répond (" + cfg.model + ")." + ((j.content?.[0]?.text) ? "" : "") };
  }
  bad("Test inconnu.", 404);
});

/* ================= campagnes / messages ================= */
route("GET", "/api/campaigns", "user", async () => ({ campaigns: await listCampaigns() }));
route("POST", "/api/campaigns", "admin", async ({ body }) => ({ campaign: await createCampaign({ type: String(body.type || "relance"), driverIds: Array.isArray(body.driverIds) ? body.driverIds.map(Number) : undefined, title: body.title, origin: "user" }) }));
route("GET", "/api/campaigns/:id", "user", async ({ params }) => ({ campaign: await getCampaign(Number(params.id)) }));
route("POST", "/api/campaigns/:id/send", "admin", async ({ params, body }) => sendCampaignBatch(Number(params.id), Math.min(Math.max(Number(body.limit) || 15, 1), 30), { retryFailed: !!body.retryFailed }));
route("POST", "/api/campaigns/:id/cancel", "admin", async ({ params }) => { await cancelCampaign(Number(params.id)); return { campaign: await getCampaign(Number(params.id)) }; });
route("PATCH", "/api/campaigns/:id/items/:driverId", "admin", async ({ params, body }) => {
  await setItemStatus(Number(params.id), Number(params.driverId), body.status === "pending" ? "pending" : "skipped");
  return { campaign: await getCampaign(Number(params.id)) };
});
route("GET", "/api/replies", "user", async () => ({ replies: await recentReplies(40) }));
route("GET", "/api/relance-targets", "user", async () => {
  const t = relanceTargets(await loadDrivers());
  return { all: t.all.length, ready: t.ready.map((d) => d.id), noPhone: t.noPhone, recent: t.recent };
});

/* ================= agent ================= */
route("POST", "/api/agent/chat", "admin", async ({ body }) => chat(Array.isArray(body.messages) ? body.messages : []));

/* ================= distribution ================= */
export async function dispatch(req: Request): Promise<Response> {
  const url = new URL(req.url);
  try {
    const m = match(req.method, url.pathname);
    if (!m) {
      if (pathExists(url.pathname)) throw new HttpError(405, "Méthode non autorisée.");
      throw new HttpError(404, "Route inconnue.");
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      // anti-CSRF : un navigateur ne peut pas ajouter cet en-tête depuis un autre site sans autorisation CORS (jamais accordée ici)
      if (req.headers.get("x-requested-with") !== "fox") throw new HttpError(403, "Requête refusée.");
    }
    let user = null;
    if (m.r.auth !== "none") {
      user = await currentUser(req);
      if (!user) throw new HttpError(401, "Connexion requise.");
      if (m.r.auth === "admin" && user.role !== "admin") throw new HttpError(403, "Compte en lecture seule.");
    }
    const body = await readBody(req);
    const out = await m.r.h({ req, url, params: m.params, body, user } as Ctx);
    return out instanceof Response ? out : json(out);
  } catch (e: any) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error("API error", req.method, url.pathname, e);
    return json({ error: "Erreur interne du serveur." }, 500);
  }
}
export { COOKIE };
