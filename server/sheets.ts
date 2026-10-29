import "./env.ts";
import { createSign, createHash } from "node:crypto";
import * as L from "../public/lib.js";
import { getSetting } from "./settings.ts";
import { HttpError } from "./crypto.ts";

/** Lien Google (partage, "publié sur le web", etc.) -> lien CSV téléchargeable. */
export function normalizeCsvUrl(url: string): string {
  const u = String(url || "").trim();
  if (!u) return "";
  if (/\/pub\?/.test(u) || /output=csv/.test(u) || /format=csv/.test(u)) return u;
  const m = u.match(/docs\.google\.com\/spreadsheets\/d\/([^/]+)/);
  if (m && !/\/d\/e\//.test(u)) {
    const gid = (u.match(/[#&?]gid=(\d+)/) || [])[1] || "0";
    return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv&gid=${gid}`;
  }
  return u;
}

async function fetchText(url: string): Promise<string> {
  let r: Response;
  try { r = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(25000), headers: { "user-agent": "FoxDrive/1.0" } }); }
  catch (e: any) { throw new HttpError(502, "Impossible de joindre le fichier Google : " + (e?.message || e)); }
  if (!r.ok) throw new HttpError(502, "Le fichier Google a répondu " + r.status + ". Vérifie que le partage est « Tous les utilisateurs disposant du lien » ou que la feuille est publiée sur le web.");
  const t = await r.text();
  if (/^\s*<(!doctype|html)/i.test(t)) throw new HttpError(502, "Google a renvoyé une page de connexion au lieu des données : le fichier n'est pas public. Utilise « Fichier > Partager > Publier sur le web » (format CSV) ou le mode compte de service.");
  return t;
}

/* ---------- compte de service Google (accès privé, lecture seule) ---------- */
let tokenCache: { token: string; exp: number; email: string } | null = null;
async function googleToken(saJson: string): Promise<string> {
  let sa: any;
  try { sa = JSON.parse(saJson); } catch { throw new HttpError(400, "La clé du compte de service Google n'est pas un JSON valide."); }
  if (tokenCache && tokenCache.email === sa.client_email && tokenCache.exp > Date.now() + 60000) return tokenCache.token;
  const now = Math.floor(Date.now() / 1000);
  const b = (o: any) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = b({ alg: "RS256", typ: "JWT" }) + "." + b({
    iss: sa.client_email, scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  });
  const sig = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key).toString("base64url");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: unsigned + "." + sig }),
    signal: AbortSignal.timeout(20000),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new HttpError(502, "Google a refusé la clé du compte de service : " + (j.error_description || j.error || r.status));
  tokenCache = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000, email: sa.client_email };
  return j.access_token;
}

export function spreadsheetIdFrom(s: string): string {
  const m = String(s || "").match(/\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : String(s || "").trim();
}

async function fetchTabGrid(tab: string): Promise<string[][]> {
  const sheet: any = await getSetting("sheet");
  const sa = await getSetting<any>("google_sa");
  if (!sa) throw new HttpError(400, "Aucune clé de compte de service Google enregistrée (Réglages).");
  const id = spreadsheetIdFrom(sheet.spreadsheetId);
  if (!id) throw new HttpError(400, "Identifiant de la feuille Google manquant (Réglages).");
  const token = await googleToken(typeof sa === "string" ? sa : JSON.stringify(sa));
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(tab)}?valueRenderOption=FORMATTED_VALUE`, {
    headers: { authorization: "Bearer " + token }, signal: AbortSignal.timeout(25000),
  });
  const j: any = await r.json().catch(() => ({}));
  if (r.status === 403 || r.status === 404) throw new HttpError(502, "Accès refusé ou onglet « " + tab + " » introuvable : partage la feuille avec l'adresse du compte de service (en lecteur) et vérifie le nom de l'onglet.");
  if (!r.ok) throw new HttpError(502, "Google Sheets : " + (j?.error?.message || r.status));
  return (j.values || []).map((row: any[]) => row.map((c) => (c == null ? "" : String(c))));
}

/* ---------- lecture des données ---------- */
export type FoxParsed = { format: string; rows: any[]; all?: any[]; ignored: any; hasPickup?: boolean; hasVerif?: boolean };

export function parseFoxGrid(grid: any[][]): FoxParsed {
  const rows = grid.filter((r) => r.some((c) => String(c ?? "").trim() !== ""));
  if (!rows.length) throw new HttpError(400, "La feuille est vide.");
  // texte FoxDrive collé tel quel dans la feuille (colonne A) : on le reconstitue ligne par ligne
  if (rows.some((r) => String(r[0] ?? "").trim() === "Vérifier")) {
    return L.parseFoxText(rows.map((r) => r.map((c) => String(c ?? "")).join("\t").replace(/\t+$/, "")).join("\n"));
  }
  return L.foxRowsFromGrid(rows);
}

export async function fetchFoxFromSource(): Promise<{ parsed: FoxParsed; label: string }> {
  const sheet: any = await getSetting("sheet");
  if (sheet.mode === "api") {
    const grid = await fetchTabGrid(sheet.tab || "Chauffeurs");
    return { parsed: parseFoxGrid(grid), label: "Google Sheets (" + (sheet.tab || "Chauffeurs") + ")" };
  }
  const url = normalizeCsvUrl(sheet.csvUrl);
  if (!url) throw new HttpError(400, "Aucune source configurée : renseigne le lien de ta feuille Google dans Réglages.");
  const text = await fetchText(url);
  return { parsed: parseFoxGrid(L.parseCSV(text)), label: "Google Sheets (lien CSV)" };
}

export async function fetchContactsFromSource(): Promise<{ entries: any[]; label: string } | null> {
  const sheet: any = await getSetting("sheet");
  if (sheet.mode === "api") {
    if (!sheet.contactsTab) return null;
    const grid = await fetchTabGrid(sheet.contactsTab);
    return { entries: L.contactsFromGrid(grid), label: "Google Sheets (" + sheet.contactsTab + ")" };
  }
  const url = normalizeCsvUrl(sheet.contactsCsvUrl);
  if (!url) return null;
  return { entries: L.contactsFromGrid(L.parseCSV(await fetchText(url))), label: "Google Sheets (contacts)" };
}

export function hashRows(rows: any[]): string {
  const canon = rows.map((r) => [r.plate, r.name, r.vehicle, r.lastVerif || "", r.pickup || ""].join("|")).sort().join("\n");
  return createHash("sha256").update(canon).digest("hex").slice(0, 24);
}

export async function sourceConfigured(): Promise<boolean> {
  const s: any = await getSetting("sheet");
  if (s.mode === "api") return !!(s.spreadsheetId && (await getSetting("google_sa")));
  return !!s.csvUrl;
}
