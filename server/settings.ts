import "./env.ts";
import { q } from "./db.ts";
import { decrypt, encrypt } from "./crypto.ts";

/** Réglages non secrets (JSON clair) et secrets (chiffrés). */
export const SECRET_KEYS = new Set(["google_sa", "whatsapp", "anthropic"]);

export const DEFAULTS: Record<string, any> = {
  sheet: { mode: "csv", csvUrl: "", contactsCsvUrl: "", spreadsheetId: "", tab: "Chauffeurs", contactsTab: "Contacts" },
  automation: { autoApplySync: true, autoSendRelance: false, maxPerDay: 30, dailyDraft: true },
  wa_templates: {
    relance: { name: "relance_verification", lang: "fr" },
    revision: { name: "revision_vehicule", lang: "fr" },
    controle: { name: "controle_vehicule", lang: "fr" },
    relance_ferme: { name: "relance_ferme_verification", lang: "fr" },
  },
  sync_state: { hash: "", lastRunAt: null, lastOkAt: null, lastError: "" },
};

export async function getSetting<T = any>(key: string): Promise<T> {
  const rows = await q("SELECT value, secret FROM settings WHERE key = $1", [key]);
  if (!rows.length) return structuredClone(DEFAULTS[key] ?? null);
  const raw = rows[0].secret ? decrypt(rows[0].value) : rows[0].value;
  const v = JSON.parse(raw);
  const d = DEFAULTS[key];
  return (d && typeof d === "object" && !Array.isArray(d) && v && typeof v === "object") ? { ...structuredClone(d), ...v } : v;
}

export async function setSetting(key: string, value: any): Promise<void> {
  const secret = SECRET_KEYS.has(key);
  const raw = JSON.stringify(value);
  await q(
    `INSERT INTO settings (key, value, secret, updated_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, secret = EXCLUDED.secret, updated_at = now()`,
    [key, secret ? encrypt(raw) : raw, secret],
  );
}

/** Vue pour l'interface : les secrets ne sortent jamais, seulement un indicateur. */
export async function publicSettings() {
  const sheet = await getSetting("sheet");
  const automation = await getSetting("automation");
  const wa_templates = await getSetting("wa_templates");
  const sync_state = await getSetting("sync_state");
  const sa = await getSetting<any>("google_sa");
  const wa = await getSetting<any>("whatsapp");
  const an = await getSetting<any>("anthropic");
  let saEmail = "";
  try { saEmail = sa ? JSON.parse(typeof sa === "string" ? sa : JSON.stringify(sa)).client_email || "" : ""; } catch { /* ignore */ }
  const hint = (s?: string) => (s ? "••••" + String(s).slice(-4) : "");
  return {
    sheet, automation, wa_templates, sync_state,
    google_sa: { set: !!sa, email: saEmail },
    whatsapp: { set: !!(wa && wa.token && wa.phoneNumberId), phoneNumberId: wa?.phoneNumberId || "", wabaId: wa?.wabaId || "", tokenHint: hint(wa?.token), verifyToken: wa?.verifyToken || "", appSecretSet: !!wa?.appSecret },
    anthropic: { set: !!an?.apiKey, keyHint: hint(an?.apiKey), model: an?.model || "claude-sonnet-5-5" },
  };
}
