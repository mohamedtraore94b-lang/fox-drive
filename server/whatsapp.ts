import "./env.ts";
import { q } from "./db.ts";
import * as L from "../public/lib.js";
import { getSetting } from "./settings.ts";
import { HttpError } from "./crypto.ts";
import { withState } from "./repo.ts";

const GRAPH = "https://graph.facebook.com/v21.0";

export type WaConfig = { token: string; phoneNumberId: string; wabaId?: string; verifyToken?: string; appSecret?: string };

export async function waConfig(): Promise<WaConfig | null> {
  const c = await getSetting<any>("whatsapp");
  return c && c.token && c.phoneNumberId ? c : null;
}

/**
 * Textes des modèles à créer dans Meta (catégorie « Utilitaire », langue français).
 * {{1}} = prénom, {{2}} = immatriculation. Les mêmes mots que dans l'app, pour que le chauffeur lise la même chose.
 */
export const TEMPLATE_BODIES: Record<string, { label: string; body: string }> = {
  relance: {
    label: "Relance mensuelle (gentille)",
    body: "Bonjour {{1}},\n\nC'est une première relance toute simple 🙂 Dans le cadre du suivi mensuel de notre flotte, il nous faut la vérification de votre véhicule ({{2}}) : merci de nous envoyer une photo de chaque côté ainsi qu'une photo du compteur kilométrique.\n\nL'idéal reste de passer directement à l'agence si votre emploi du temps le permet.\n\nMerci de faire cela dès que possible.\n\nBonne journée,\nFOX DRIVE",
  },
  relance_ferme: {
    label: "Relance ferme (pénalité 50 €)",
    body: "Bonjour {{1}},\n\nJe vous ai déjà contacté au sujet de la vérification mensuelle de votre véhicule ({{2}}) (photos de chaque côté + compteur kilométrique), et je n'ai toujours rien reçu de votre part.\n\nSans retour rapide, une pénalité de 50€ s'appliquera.\n\nMerci de faire le nécessaire dès aujourd'hui, ou de passer directement à l'agence.\n\nCordialement,\nFOX DRIVE",
  },
  revision: {
    label: "Révision",
    body: "Bonjour {{1}},\n\nJe vous écris au sujet de la révision de votre véhicule ({{2}}).\n\nSi vous en avez besoin, merci de me le faire savoir afin qu'on prenne rendez-vous ensemble.\n\nCordialement,\nFOX DRIVE",
  },
  controle: {
    label: "Contrôle",
    body: "Bonjour {{1}},\n\nMerci de vous présenter avec votre véhicule ({{2}}) au " + L.ADDRESS + " pour effectuer le contrôle prévu.\n\nMerci de me confirmer votre disponibilité.\n\nCordialement,\nFOX DRIVE",
  },
};

export function templateParams(d: any): string[] {
  const clean = (s: string) => String(s || "").replace(/[\n\t]+/g, " ").replace(/ {2,}/g, " ").trim();
  return [clean(L.firstName(d.name)) || "Bonjour", clean(L.fmtPlate(d.plate)) || "—"];
}

async function graph(cfg: WaConfig, path: string, body: any) {
  let r: Response;
  try {
    r = await fetch(`${GRAPH}/${path}`, {
      method: "POST", headers: { authorization: "Bearer " + cfg.token, "content-type": "application/json" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(20000),
    });
  } catch (e: any) { throw new HttpError(502, "WhatsApp injoignable : " + (e?.message || e)); }
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) {
    const m = j?.error?.error_user_msg || j?.error?.message || ("HTTP " + r.status);
    throw new HttpError(r.status === 401 ? 401 : 502, "WhatsApp : " + m + (j?.error?.code ? " (code " + j.error.code + ")" : ""));
  }
  return j;
}

export async function sendTemplate(cfg: WaConfig, to: string, name: string, lang: string, params: string[]): Promise<string> {
  const j = await graph(cfg, `${cfg.phoneNumberId}/messages`, {
    messaging_product: "whatsapp", to, type: "template",
    template: { name, language: { code: lang || "fr" }, components: [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }] },
  });
  return j.messages?.[0]?.id || "";
}
export async function sendText(cfg: WaConfig, to: string, body: string): Promise<string> {
  const j = await graph(cfg, `${cfg.phoneNumberId}/messages`, { messaging_product: "whatsapp", to, type: "text", text: { body, preview_url: false } });
  return j.messages?.[0]?.id || "";
}

/** Le chauffeur a-t-il écrit dans les dernières 24 h ? (alors un message libre est autorisé) */
async function windowOpen(driverId: number): Promise<boolean> {
  const [r] = await q("SELECT 1 AS ok FROM messages WHERE driver_id = $1 AND direction = 'in' AND ts > now() - interval '24 hours' LIMIT 1", [driverId]);
  return !!r;
}

export type SendResult = { ok: boolean; waId?: string; error?: string; mode?: "template" | "text" };

/** Envoie un message à un chauffeur, l'enregistre dans l'historique et met à jour la date de contact. */
export async function sendToDriver(d: any, kind: string, opts: { campaignId?: number; text?: string } = {}): Promise<SendResult> {
  const cfg = await waConfig();
  if (!cfg) throw new HttpError(400, "WhatsApp Business n'est pas encore configuré (Réglages).");
  const np = L.normPhone(d.phone);
  if (!np.ok) return { ok: false, error: "Numéro invalide ou absent" };
  const to = L.waNumber(np.phone);
  const body = opts.text || L.buildMessage(d, kind);
  let waId = "", mode: "template" | "text" = "template", error = "";
  try {
    if (opts.text || (await windowOpen(d.id))) { mode = "text"; waId = await sendText(cfg, to, body); }
    else {
      const t: any = (await getSetting("wa_templates"))[kind];
      if (!t?.name) throw new HttpError(400, "Aucun modèle WhatsApp configuré pour « " + kind + " » (Réglages).");
      waId = await sendTemplate(cfg, to, t.name, t.lang || "fr", templateParams(d));
    }
  } catch (e: any) { error = e?.message || String(e); }

  await q(
    "INSERT INTO messages (driver_id, phone, direction, kind, body, wa_id, status, error, campaign_id) VALUES ($1,$2,'out',$3,$4,$5,$6,$7,$8)",
    [d.id, np.phone, kind, body, waId || null, error ? "failed" : "sent", error, opts.campaignId ?? null]);
  if (error) return { ok: false, error, mode };
  const label = (L.MESSAGE_TYPES.find((t: any) => t.key === kind) || { label: kind }).label;
  await withState((S) => {
    const x = S.drivers.find((y) => y.id === d.id);
    if (!x) return;
    x.lastContacted = new Date().toISOString();
    L.pushLog(S, "contact", x, "Message WhatsApp envoyé · " + label + " (automatique)");
  });
  return { ok: true, waId, mode };
}

/* ---------- webhook entrant ---------- */
export async function handleWebhookPayload(payload: any) {
  const drivers = await q("SELECT id, name, phone FROM drivers");
  const byWa = new Map<string, any>();
  drivers.forEach((d: any) => { const n = L.normPhone(d.phone); if (n.ok) byWa.set(L.waNumber(n.phone), d); });
  let statuses = 0, inbound = 0;
  for (const entry of payload?.entry || []) for (const ch of entry.changes || []) {
    const v = ch.value || {};
    for (const s of v.statuses || []) {
      const st = String(s.status || "");
      const err = s.errors?.[0] ? (s.errors[0].error_data?.details || s.errors[0].message || "") : "";
      await q("UPDATE messages SET status = $2, error = CASE WHEN $3 <> '' THEN $3 ELSE error END WHERE wa_id = $1 AND status <> 'read'", [s.id, st, err]);
      if (st === "failed") await q("UPDATE campaign_items SET status = 'failed', error = $2 WHERE wa_id = $1", [s.id, err]);
      statuses++;
    }
    for (const m of v.messages || []) {
      const from = String(m.from || "");
      const d = byWa.get(from);
      const text = m.text?.body || (m.type === "image" ? "[photo]" : m.type === "button" ? (m.button?.text || "[bouton]") : "[" + (m.type || "message") + "]");
      const ins = await q(
        "INSERT INTO messages (driver_id, phone, direction, kind, body, wa_id, status) VALUES ($1,$2,'in','reponse',$3,$4,'received') ON CONFLICT (wa_id) DO NOTHING RETURNING id",
        [d?.id ?? null, from, text, m.id || null]);
      if (ins.length) {
        inbound++;
        await q("INSERT INTO events (type, driver_id, name, text, meta) VALUES ('reply', $1, $2, $3, '{}')",
          [d?.id ?? null, d?.name || from, "Réponse WhatsApp : " + String(text).slice(0, 140)]);
      }
    }
  }
  return { statuses, inbound };
}
