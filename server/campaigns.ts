import "./env.ts";
import { q } from "./db.ts";
import * as L from "../public/lib.js";
import { HttpError } from "./crypto.ts";
import { loadDrivers } from "./repo.ts";
import { getSetting } from "./settings.ts";
import { sendToDriver, waConfig } from "./whatsapp.ts";

export const AUTO_TYPES = ["relance", "revision", "controle"];   // la relance ferme (50 €) ne part jamais sans une décision humaine

/** Chauffeurs à relancer : actifs, en retard de vérification, avec un numéro, pas contactés ces derniers jours. */
export function relanceTargets(drivers: any[], now = L.todayDate()) {
  const all = drivers.filter(L.isActive).filter((d) => L.dueStatus(d, now) === "overdue");
  const withPhone = all.filter((d) => L.normPhone(d.phone).ok);
  const ready = withPhone.filter((d) => !L.recentlyContacted(d, now));
  return { all, ready, noPhone: all.length - withPhone.length, recent: withPhone.length - ready.length };
}

export async function createCampaign(opts: { type: string; driverIds?: number[]; origin?: string; title?: string; note?: string }) {
  const type = opts.type;
  if (!L.MESSAGE_TYPES.some((t: any) => t.key === type)) throw new HttpError(400, "Type de message inconnu.");
  const drivers = await loadDrivers();
  const byId = new Map(drivers.map((d) => [d.id, d]));
  const now = L.todayDate();
  let ids: number[], skipped: { id: number; reason: string }[] = [];
  if (opts.driverIds?.length) ids = [...new Set(opts.driverIds)];
  else {
    const t = relanceTargets(drivers, now);
    ids = t.ready.map((d) => d.id);
  }
  const items: { id: number; status: string; reason: string }[] = [];
  for (const id of ids) {
    const d = byId.get(id);
    if (!d) continue;
    if (!L.isActive(d)) { items.push({ id, status: "skipped", reason: "Plus dans le suivi" }); continue; }
    if (!L.normPhone(d.phone).ok) { items.push({ id, status: "skipped", reason: "Numéro absent ou invalide" }); continue; }
    if (type === "relance" && opts.driverIds?.length === undefined && L.recentlyContacted(d, now)) { items.push({ id, status: "skipped", reason: "Contacté il y a moins de " + L.COOLDOWN_DAYS + " jours" }); continue; }
    items.push({ id, status: "pending", reason: "" });
  }
  if (!items.length) throw new HttpError(422, "Personne à contacter pour le moment.");
  const title = opts.title || ((L.MESSAGE_TYPES.find((t: any) => t.key === type) as any)?.label || type);
  const [c] = await q("INSERT INTO campaigns (type, origin, title, note) VALUES ($1,$2,$3,$4) RETURNING id", [type, opts.origin || "user", title, opts.note || ""]);
  for (const it of items) await q("INSERT INTO campaign_items (campaign_id, driver_id, status, reason) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING", [c.id, it.id, it.status, it.reason]);
  return getCampaign(Number(c.id));
}

export async function getCampaign(id: number) {
  const [c] = await q(
    `SELECT id, type, status, origin, title, note, to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt",
       to_char(sent_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "sentAt" FROM campaigns WHERE id = $1`, [id]);
  if (!c) throw new HttpError(404, "Campagne introuvable.");
  const items = await q(
    `SELECT i.id, i.driver_id AS "driverId", i.status, i.reason, i.error, d.name, d.plate, d.phone
       FROM campaign_items i LEFT JOIN drivers d ON d.id = i.driver_id WHERE i.campaign_id = $1 ORDER BY d.name`, [id]);
  const count = (s: string) => items.filter((i: any) => i.status === s).length;
  return { ...c, id: Number(c.id), items, counts: { pending: count("pending"), sent: count("sent"), failed: count("failed"), skipped: count("skipped"), total: items.length } };
}

export async function listCampaigns(limit = 30) {
  const rows = await q(
    `SELECT c.id, c.type, c.status, c.origin, c.title, to_char(c.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt",
       count(i.*) FILTER (WHERE i.status = 'pending')::int AS pending, count(i.*) FILTER (WHERE i.status = 'sent')::int AS sent,
       count(i.*) FILTER (WHERE i.status = 'failed')::int AS failed, count(i.*) FILTER (WHERE i.status = 'skipped')::int AS skipped
     FROM campaigns c LEFT JOIN campaign_items i ON i.campaign_id = c.id GROUP BY c.id ORDER BY c.id DESC LIMIT $1`, [limit]);
  return rows.map((r: any) => ({ ...r, id: Number(r.id) }));
}

export async function setItemStatus(campaignId: number, driverId: number, status: "skipped" | "pending") {
  await q("UPDATE campaign_items SET status = $3, reason = CASE WHEN $3 = 'skipped' THEN 'Retiré à la main' ELSE '' END WHERE campaign_id = $1 AND driver_id = $2 AND status IN ('pending','skipped')", [campaignId, driverId, status]);
}

export async function cancelCampaign(id: number) {
  await q("UPDATE campaigns SET status = 'cancelled' WHERE id = $1 AND status IN ('draft','sending')", [id]);
}

/** Envoie jusqu'à `limit` messages en attente (appelé en boucle par l'interface ou par la tâche planifiée). */
export async function sendCampaignBatch(id: number, limit = 20, opts: { retryFailed?: boolean } = {}) {
  if (!(await waConfig())) throw new HttpError(400, "WhatsApp Business n'est pas encore configuré (Réglages).");
  const [c] = await q("SELECT id, type, status FROM campaigns WHERE id = $1", [id]);
  if (!c) throw new HttpError(404, "Campagne introuvable.");
  if (c.status === "cancelled") throw new HttpError(409, "Cette campagne a été annulée.");
  if (c.status === "sent" && !opts.retryFailed) throw new HttpError(409, "Cette campagne est déjà envoyée.");
  if (opts.retryFailed) await q("UPDATE campaign_items SET status = 'pending', error = '' WHERE campaign_id = $1 AND status = 'failed'", [id]);
  await q("UPDATE campaigns SET status = 'sending' WHERE id = $1", [id]);

  // réservation atomique des lignes à traiter (évite le double envoi si deux requêtes se croisent)
  const claimed = await q(
    `UPDATE campaign_items SET status = 'failed', error = 'envoi en cours'
      WHERE id IN (SELECT id FROM campaign_items WHERE campaign_id = $1 AND status = 'pending' ORDER BY id LIMIT $2 FOR UPDATE SKIP LOCKED)
      RETURNING id, driver_id AS "driverId"`, [id, limit]);
  const drivers = await loadDrivers();
  const byId = new Map(drivers.map((d) => [d.id, d]));
  const now = L.todayDate();
  let sent = 0, failed = 0;
  for (const it of claimed) {
    const d = byId.get(it.driverId);
    if (!d || !L.isActive(d)) { await q("UPDATE campaign_items SET status = 'skipped', reason = 'Plus dans le suivi', error = '' WHERE id = $1", [it.id]); continue; }
    // garde-fou : pas de seconde relance mensuelle à quelqu'un déjà contacté il y a moins de 3 jours
    if (c.type === "relance" && L.recentlyContacted(d, now)) {
      await q("UPDATE campaign_items SET status = 'skipped', reason = 'Contacté il y a moins de 3 jours', error = '' WHERE id = $1", [it.id]); continue;
    }
    const r = await sendToDriver(d, c.type, { campaignId: id });
    if (r.ok) { sent++; await q("UPDATE campaign_items SET status = 'sent', wa_id = $2, error = '', sent_at = now() WHERE id = $1", [it.id, r.waId || null]); }
    else { failed++; await q("UPDATE campaign_items SET status = 'failed', error = $2 WHERE id = $1", [it.id, r.error || "Erreur"]); }
  }
  const [left] = await q("SELECT count(*)::int AS n FROM campaign_items WHERE campaign_id = $1 AND status = 'pending'", [id]);
  if (left.n === 0) await q("UPDATE campaigns SET status = 'sent', sent_at = now() WHERE id = $1", [id]);
  return { sent, failed, remaining: left.n, campaign: await getCampaign(id) };
}

/** Nombre de messages déjà envoyés aujourd'hui par les campagnes automatiques (plafond quotidien). */
export async function autoSentToday(): Promise<number> {
  const [r] = await q(
    `SELECT count(*)::int AS n FROM messages m JOIN campaigns c ON c.id = m.campaign_id
      WHERE m.direction = 'out' AND m.status <> 'failed' AND c.origin IN ('daily','agent')
        AND (m.ts AT TIME ZONE 'Europe/Paris')::date = (now() AT TIME ZONE 'Europe/Paris')::date`);
  return r.n;
}

export async function messagesFor(driverId: number, limit = 50) {
  return (await q(
    `SELECT id, to_char(ts AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS ts, direction, kind, body, status, error
       FROM messages WHERE driver_id = $1 ORDER BY ts DESC, id DESC LIMIT $2`, [driverId, limit])).map((r: any) => ({ ...r, id: Number(r.id) }));
}

export async function recentReplies(limit = 30) {
  return (await q(
    `SELECT m.id, to_char(m.ts AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS ts, m.driver_id AS "driverId", d.name, m.phone, m.body
       FROM messages m LEFT JOIN drivers d ON d.id = m.driver_id WHERE m.direction = 'in' ORDER BY m.ts DESC LIMIT $1`, [limit])).map((r: any) => ({ ...r, id: Number(r.id) }));
}

/** Tâche quotidienne : prépare (et si autorisé, envoie) la relance des retards. */
export async function dailyRun() {
  const auto: any = await getSetting("automation");
  if (!auto.dailyDraft) return { status: "disabled" };
  const open = await q("SELECT id FROM campaigns WHERE origin = 'daily' AND status IN ('draft','sending') ORDER BY id DESC LIMIT 1");
  if (open.length) return { status: "already-open", campaignId: Number(open[0].id) };
  const drivers = await loadDrivers();
  const t = relanceTargets(drivers);
  if (!t.ready.length) return { status: "nobody" };
  const cap = Math.max(1, Number(auto.maxPerDay) || 30);
  const note = `${t.all.length} en retard · ${t.ready.length} à relancer` + (t.recent ? ` · ${t.recent} déjà contacté(s) récemment` : "") + (t.noPhone ? ` · ${t.noPhone} sans numéro` : "");
  const camp = await createCampaign({ type: "relance", driverIds: t.ready.slice(0, cap).map((d) => d.id), origin: "daily", title: "Relance du jour", note });
  if (auto.autoSendRelance && (await waConfig())) {
    const left = cap - (await autoSentToday());
    if (left > 0) { const r = await sendCampaignBatch(camp.id, Math.min(left, 10)); return { status: r.remaining ? "sending" : "sent", ...r }; }
  }
  return { status: "draft", campaignId: camp.id, ready: t.ready.length };
}

/** Reprend l'envoi des campagnes automatiques commencées (lots de 10 par passage, plafond quotidien respecté). */
export async function continueAutoSending() {
  const auto: any = await getSetting("automation");
  if (!auto.autoSendRelance || !(await waConfig())) return { status: "off" };
  const open = await q("SELECT id FROM campaigns WHERE origin = 'daily' AND status = 'sending' ORDER BY id LIMIT 1");
  if (!open.length) return { status: "idle" };
  const cap = Math.max(1, Number(auto.maxPerDay) || 30);
  const left = cap - (await autoSentToday());
  if (left <= 0) return { status: "cap-reached" };
  const r = await sendCampaignBatch(Number(open[0].id), Math.min(left, 10));
  return { status: "sent", sent: r.sent, remaining: r.remaining };
}
