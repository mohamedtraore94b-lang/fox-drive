import "./env.ts";
import { q } from "./db.ts";
import * as L from "../public/lib.js";
import { HttpError } from "./crypto.ts";
import { loadDrivers, loadEvents, withState } from "./repo.ts";
import { getSetting } from "./settings.ts";
import { createCampaign, messagesFor, recentReplies, relanceTargets, AUTO_TYPES } from "./campaigns.ts";
import { runFoxSync } from "./sync.ts";

const API = "https://api.anthropic.com/v1/messages";
const MAX_ROUNDS = 8;
const DEADLINE_MS = 48000;

const TOOLS = [
  { name: "fleet_summary", description: "Vue d'ensemble de la flotte : nombre de chauffeurs actifs, en retard de vérification, à faire cette semaine, à jour, jamais vérifiés, sans numéro, imports en attente de validation, dernière synchro.", input_schema: { type: "object", properties: {} } },
  { name: "list_drivers", description: "Liste des chauffeurs avec leur échéance de vérification. days_to_due négatif = en retard de N jours. Utilise filter pour cibler.", input_schema: { type: "object", properties: {
    filter: { type: "string", enum: ["overdue", "soon", "ok", "unknown", "no_phone", "to_relance", "recently_contacted", "all_active", "archived"], description: "overdue = en retard ; soon = dans les 7 jours ; ok = à jour ; unknown = jamais vérifié ; to_relance = en retard, avec numéro, pas contacté depuis 3 jours" },
    query: { type: "string", description: "Texte à chercher dans le nom, la plaque ou le véhicule" },
    limit: { type: "integer", description: "Maximum de lignes (60 par défaut)" } }, required: ["filter"] } },
  { name: "get_driver", description: "Fiche d'un chauffeur (par id ou par nom) avec ses derniers événements et messages.", input_schema: { type: "object", properties: { id: { type: "integer" }, name: { type: "string" } } } },
  { name: "recent_replies", description: "Derniers messages WhatsApp reçus des chauffeurs.", input_schema: { type: "object", properties: { limit: { type: "integer" } } } },
  { name: "prepare_campaign", description: "Prépare un BROUILLON de campagne WhatsApp. Rien n'est envoyé : l'utilisateur la valide et l'envoie lui-même depuis l'onglet Campagnes. Sans driver_ids, cible automatiquement les chauffeurs à relancer.", input_schema: { type: "object", properties: {
    type: { type: "string", enum: AUTO_TYPES, description: "relance = relance mensuelle gentille ; revision = proposer un rendez-vous de révision ; controle = convocation pour un contrôle" },
    driver_ids: { type: "array", items: { type: "integer" } }, title: { type: "string" } }, required: ["type"] } },
  { name: "add_note", description: "Ajoute une note libre sur la fiche d'un chauffeur.", input_schema: { type: "object", properties: { driver_id: { type: "integer" }, note: { type: "string" } }, required: ["driver_id", "note"] } },
  { name: "record_verification_received", description: "Enregistre que le chauffeur a envoyé sa vérification (photos + compteur) aujourd'hui : son cycle de 30 jours repart d'aujourd'hui. À utiliser seulement si l'utilisateur l'affirme.", input_schema: { type: "object", properties: { driver_id: { type: "integer" } }, required: ["driver_id"] } },
  { name: "sync_now", description: "Relit tout de suite la feuille Google source et met la flotte à jour (nouveaux chauffeurs, changements de véhicule, départs).", input_schema: { type: "object", properties: {} } },
];

function systemPrompt(): string {
  const today = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" });
  return `Tu es l'assistant de suivi de flotte de FOX DRIVE (agence de location VTC à Rungis). Tu aides le gérant à suivre les vérifications mensuelles des véhicules des chauffeurs.
Nous sommes le ${today} (heure de Paris).

Règles de gestion :
- Chaque chauffeur doit envoyer une vérification (photos de chaque côté + compteur) tous les 30 jours. L'échéance = dernière date connue (vérification, vérification reçue ou prise du véhicule) + 30 jours.
- « À relancer » = en retard, avec un numéro valide, pas contacté depuis moins de 3 jours.
- Les chauffeurs absents de l'export FoxDrive sont considérés comme partis (véhicule rendu) et ne sont plus suivis.
- Tu ne peux JAMAIS envoyer de message toi-même. Tu prépares des brouillons de campagne (prepare_campaign) que le gérant valide et envoie dans l'onglet « Campagnes ». Dis-le clairement quand tu en prépares un.
- Tu ne prépares que : relance (gentille), révision, contrôle. La relance ferme avec pénalité de 50 € est une décision strictement humaine : ne la propose pas d'office ; si on te la demande, explique qu'elle se lance à la main depuis la fiche du chauffeur.
- N'invente jamais de chiffre ni de nom : appuie-toi sur les outils. Si une donnée manque, dis-le.
Style : français, direct, concis. Pas de longs tableaux ; pour une liste de chauffeurs, une ligne chacun (nom · plaque · retard).`;
}

type Ctx = { tools: any[]; campaignId?: number };

function slim(d: any, now: Date) {
  const due = L.dueDate(d);
  return {
    id: d.id, name: d.name, plate: L.fmtPlate(d.plate), vehicle: d.vehicle, has_phone: L.normPhone(d.phone).ok,
    last_verif: d.lastVerif || null, picked_up: d.pickup || null, due: due ? L.toISO(due) : null,
    days_to_due: due ? L.daysBetween(now, due) : null, last_contacted: d.lastContacted ? d.lastContacted.slice(0, 10) : null,
    status: d.status,
  };
}

async function runTool(name: string, input: any, ctx: Ctx): Promise<any> {
  const now = L.todayDate();
  if (name === "fleet_summary") {
    const drivers = await loadDrivers();
    const A = drivers.filter(L.isActive);
    const by = (s: string) => A.filter((d) => L.dueStatus(d, now) === s).length;
    const t = relanceTargets(drivers, now);
    const [p] = await q("SELECT count(*)::int AS n FROM imports WHERE status = 'pending'");
    const st: any = await getSetting("sync_state");
    return { actifs: A.length, en_retard: by("overdue"), cette_semaine: by("soon"), a_jour: by("ok"), jamais_verifies: by("unknown"), sans_numero: A.filter((d) => !L.normPhone(d.phone).ok).length, a_relancer_maintenant: t.ready.length, deja_contactes_recemment: t.recent, archives: drivers.filter((d) => d.status === "archived").length, imports_en_attente: p.n, derniere_synchro: st.lastOkAt };
  }
  if (name === "list_drivers") {
    const drivers = await loadDrivers();
    const A = drivers.filter(L.isActive);
    let list: any[];
    switch (input.filter) {
      case "overdue": case "soon": case "ok": case "unknown": list = A.filter((d) => L.dueStatus(d, now) === input.filter); break;
      case "no_phone": list = A.filter((d) => !L.normPhone(d.phone).ok); break;
      case "to_relance": list = relanceTargets(drivers, now).ready; break;
      case "recently_contacted": list = A.filter((d) => L.recentlyContacted(d, now)); break;
      case "archived": list = drivers.filter((d) => d.status === "archived"); break;
      default: list = A;
    }
    if (input.query) { const k = L.normText(input.query); list = list.filter((d) => L.normText(d.name + " " + d.plate + " " + d.vehicle).includes(k)); }
    list = list.sort((a, b) => ((L.dueDate(a)?.getTime() ?? 9e15) - (L.dueDate(b)?.getTime() ?? 9e15)));
    const limit = Math.min(Math.max(Number(input.limit) || 60, 1), 100);
    return { total: list.length, shown: Math.min(list.length, limit), drivers: list.slice(0, limit).map((d) => slim(d, now)) };
  }
  if (name === "get_driver") {
    const drivers = await loadDrivers();
    let d = input.id ? drivers.find((x) => x.id === Number(input.id)) : null;
    if (!d && input.name) {
      const idx = L.buildNameIndex(drivers);
      const f = L.findDriver(input.name, drivers, idx, null, null);
      d = f?.driver;
      if (!d) { const k = L.normText(input.name); const c = drivers.filter((x) => L.normText(x.name).includes(k)); if (c.length === 1) d = c[0]; else if (c.length > 1) return { ambiguous: c.slice(0, 8).map((x) => ({ id: x.id, name: x.name })) }; }
    }
    if (!d) return { error: "Chauffeur introuvable." };
    return { ...slim(d, now), phone: d.phone ? L.fmtPhone(d.phone) : null, manager: d.manager, notes: d.notes, events: (await loadEvents(12, d.id)).map((e: any) => e.ts.slice(0, 10) + " " + e.text), messages: (await messagesFor(d.id, 8)).map((m: any) => m.ts.slice(0, 10) + " " + (m.direction === "in" ? "← " : "→ ") + m.body.slice(0, 120)) };
  }
  if (name === "recent_replies") return { replies: (await recentReplies(Math.min(Number(input.limit) || 15, 40))).map((r: any) => ({ at: r.ts, driver_id: r.driverId, name: r.name || r.phone, text: r.body })) };
  if (name === "prepare_campaign") {
    if (!AUTO_TYPES.includes(input.type)) return { error: "Type non autorisé pour l'agent." };
    try {
      const c = await createCampaign({ type: input.type, driverIds: input.driver_ids, origin: "agent", title: input.title });
      ctx.campaignId = c.id;
      return { campaign_id: c.id, status: "brouillon (rien n'est envoyé)", a_envoyer: c.counts.pending, ignores: c.counts.skipped, ignores_detail: c.items.filter((i: any) => i.status === "skipped").slice(0, 10).map((i: any) => i.name + " : " + i.reason), validation: "À valider dans l'onglet Campagnes." };
    } catch (e: any) { return { error: e?.message || String(e) }; }
  }
  if (name === "add_note") {
    const note = String(input.note || "").trim().slice(0, 500);
    if (!note) return { error: "Note vide." };
    return await withState((S) => {
      const d = S.drivers.find((x) => x.id === Number(input.driver_id));
      if (!d) return { error: "Chauffeur introuvable." };
      d.notes = (d.notes ? d.notes + "\n" : "") + L.toISO(new Date()) + " — " + note;
      L.pushLog(S, "note", d, "Note ajoutée : " + note.slice(0, 120));
      return { ok: true };
    });
  }
  if (name === "record_verification_received") {
    return await withState((S) => {
      const d = S.drivers.find((x) => x.id === Number(input.driver_id));
      if (!d) return { error: "Chauffeur introuvable." };
      d.lastCheckin = new Date().toISOString();
      L.pushLog(S, "verif", d, "Vérification reçue (photos + compteur) — enregistrée via l'assistant");
      return { ok: true, name: d.name, next_due: L.toISO(L.addDays(L.todayDate(), L.CYCLE_DAYS)) };
    });
  }
  if (name === "sync_now") {
    try { return await runFoxSync({ force: true, origin: "manual" }); } catch (e: any) { return { error: e?.message || String(e) }; }
  }
  return { error: "Outil inconnu : " + name };
}

export async function agentConfig() {
  const c = await getSetting<any>("anthropic");
  return c?.apiKey ? { apiKey: c.apiKey as string, model: (c.model as string) || "claude-sonnet-5-5" } : null;
}

export async function callClaude(cfg: { apiKey: string; model: string }, body: any) {
  let r: Response;
  try {
    r = await fetch(API, {
      method: "POST", signal: AbortSignal.timeout(45000),
      headers: { "x-api-key": cfg.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: cfg.model, ...body }),
    });
  } catch (e: any) { throw new HttpError(502, "L'API Claude est injoignable : " + (e?.message || e)); }
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401) throw new HttpError(400, "Clé API Claude refusée : vérifie-la dans Réglages.");
    if (r.status === 429) throw new HttpError(429, "Limite de l'API Claude atteinte, réessaie dans un instant.");
    throw new HttpError(502, "API Claude : " + (j?.error?.message || r.status));
  }
  return j;
}

/** Conversation : le client envoie l'historique en texte ; les appels d'outils se font ici, côté serveur. */
export async function chat(history: { role: "user" | "assistant"; content: string }[], origin = "chat") {
  const cfg = await agentConfig();
  if (!cfg) throw new HttpError(400, "Agent non configuré : ajoute ta clé API Claude dans Réglages.");
  const messages: any[] = history.slice(-20).map((m) => ({ role: m.role, content: String(m.content || "").slice(0, 6000) }));
  if (!messages.length || messages[messages.length - 1].role !== "user") throw new HttpError(400, "Message vide.");
  const ctx: Ctx = { tools: [] };
  const started = Date.now();
  let tin = 0, tout = 0, reply = "";
  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (Date.now() - started > DEADLINE_MS) { reply = reply || "Je n'ai pas fini à temps : repose la question plus simplement."; break; }
    const j = await callClaude(cfg, { max_tokens: 1500, system: systemPrompt(), tools: TOOLS, messages });
    tin += j.usage?.input_tokens || 0; tout += j.usage?.output_tokens || 0;
    const blocks: any[] = j.content || [];
    const uses = blocks.filter((b) => b.type === "tool_use");
    reply = blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim() || reply;
    if (j.stop_reason !== "tool_use" || !uses.length) break;
    messages.push({ role: "assistant", content: blocks });
    const results: any[] = [];
    for (const u of uses) {
      let out: any;
      try { out = await runTool(u.name, u.input || {}, ctx); } catch (e: any) { out = { error: e?.message || String(e) }; }
      ctx.tools.push({ name: u.name, input: u.input || {}, ok: !out?.error });
      results.push({ type: "tool_result", tool_use_id: u.id, content: JSON.stringify(out).slice(0, 24000) });
    }
    messages.push({ role: "user", content: results });
  }
  const prompt = String(history[history.length - 1]?.content || "").slice(0, 500);
  await q("INSERT INTO agent_runs (origin, prompt, reply, tools, tokens_in, tokens_out) VALUES ($1,$2,$3,$4,$5,$6)", [origin, prompt, reply.slice(0, 4000), JSON.stringify(ctx.tools), tin, tout]);
  return { reply: reply || "(pas de réponse)", tools: ctx.tools, campaignId: ctx.campaignId ?? null };
}
