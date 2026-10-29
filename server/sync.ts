import "./env.ts";
import { q } from "./db.ts";
import * as L from "../public/lib.js";
import { withState } from "./repo.ts";
import { getSetting, setSetting } from "./settings.ts";
import { fetchContactsFromSource, fetchFoxFromSource, hashRows, type FoxParsed } from "./sheets.ts";
import { HttpError } from "./crypto.ts";

const MAX_ABSENT_AUTO_RATIO = 0.25;   // au-delà, on demande confirmation même en mode automatique
const MAX_ABSENT_AUTO_MIN = 8;

type Selection = { on?: string[]; off?: string[]; assign?: Record<string, number> };

function applySelection(items: any[], sel?: Selection) {
  if (!sel) return;
  const on = new Set(sel.on || []), off = new Set(sel.off || []);
  items.forEach((it) => { if (on.has(it.key)) it.on = true; if (off.has(it.key)) it.on = false; });
}

/** Nombre de changements réels dans une réconciliation FoxDrive. */
export function foxChangeCount(res: any): number {
  return res.matched.length + res.probable.length + res.added.length + res.absent.length;
}

/** Une synchro peut être appliquée sans demander quand rien n'est douteux. */
export function foxIsSafe(res: any, activeCount: number): { safe: boolean; reason: string } {
  if (res.truncated) return { safe: false, reason: "L'export contient bien moins de chauffeurs que d'habitude (copie incomplète ?)." };
  if (res.probable.length) return { safe: false, reason: res.probable.length + " nom(s) ressemblent à un chauffeur existant : à confirmer." };
  if (res.warnings.length) return { safe: false, reason: res.warnings[0] };
  const limit = Math.max(MAX_ABSENT_AUTO_MIN, Math.ceil(activeCount * MAX_ABSENT_AUTO_RATIO));
  if (res.absent.length > limit) return { safe: false, reason: res.absent.length + " départs d'un coup : à confirmer avant de les retirer du suivi." };
  return { safe: true, reason: "" };
}

/* ---------------- FoxDrive : aperçu / application manuelle ---------------- */

export async function previewFox(parsed: FoxParsed, label: string) {
  if (!parsed.rows.length) throw new HttpError(400, "Aucun chauffeur en location reconnu dans ce fichier.");
  const res = await withState((S) => L.reconcileFox(S, parsed));
  const [row] = await q(
    "INSERT INTO imports (kind, source, rows, status, payload) VALUES ('foxdrive', $1, $2, 'preview', $3) RETURNING id",
    [label, parsed.rows.length, JSON.stringify(parsed)]);
  await q("DELETE FROM imports WHERE status = 'preview' AND ts < now() - interval '2 days'");
  return { importId: Number(row.id), label, format: parsed.format, ignored: parsed.ignored, res };
}

async function loadImportPayload(id: number, kind: string, statuses: string[]) {
  const [row] = await q("SELECT id, source, status, payload FROM imports WHERE id = $1 AND kind = $2", [id, kind]);
  if (!row || !statuses.includes(row.status)) throw new HttpError(404, "Cet import n'existe plus (déjà appliqué ou refusé).");
  return row;
}

export async function applyFoxImport(importId: number, sel?: Selection) {
  const row = await loadImportPayload(importId, "foxdrive", ["preview", "pending"]);
  const parsed = row.payload as FoxParsed;
  const sum = await withState((S) => {
    const res = L.reconcileFox(S, parsed);
    applySelection([...res.matched, ...res.probable, ...res.added, ...res.absent], sel);
    return L.applyFox(S, res, row.source || "import");
  });
  await q("DELETE FROM imports WHERE id = $1", [importId]);
  await markSynced();
  return sum;
}

export async function rejectImport(importId: number) {
  await q("UPDATE imports SET status = 'rejected', payload = NULL WHERE id = $1 AND status IN ('preview','pending')", [importId]);
}

/* ---------------- FoxDrive : synchro automatique depuis la feuille ---------------- */

async function markSynced(error = "") {
  const st: any = await getSetting("sync_state");
  const now = new Date().toISOString();
  await setSetting("sync_state", { ...st, lastRunAt: now, lastOkAt: error ? st.lastOkAt : now, lastError: error });
}

export async function runFoxSync(opts: { force?: boolean; origin?: "auto" | "manual" } = {}) {
  const origin = opts.origin || "auto";
  const automation: any = await getSetting("automation");
  const st: any = await getSetting("sync_state");
  let fetched;
  try { fetched = await fetchFoxFromSource(); }
  catch (e: any) { await markSynced(e?.message || String(e)); throw e; }
  const { parsed, label } = fetched;
  if (!parsed.rows.length) { const m = "La feuille ne contient aucun chauffeur en location."; await markSynced(m); throw new HttpError(422, m); }
  const hash = hashRows(parsed.rows);

  if (!opts.force && st.hash === hash) {
    await markSynced();
    return { status: "unchanged", rows: parsed.rows.length, message: "Aucun changement depuis la dernière synchro." };
  }

  const out = await withState((S) => {
    const res = L.reconcileFox(S, parsed);
    const changes = foxChangeCount(res);
    const active = S.drivers.filter(L.isActive).length;
    if (!changes) return { kind: "nochange" as const, res };
    const safety = foxIsSafe(res, active);
    const mayAuto = automation.autoApplySync && safety.safe;
    if (mayAuto) {
      const sum = L.applyFox(S, res, label + (origin === "auto" ? " — auto" : ""));
      return { kind: "applied" as const, sum, res };
    }
    return { kind: "pending" as const, reason: safety.safe ? "Validation manuelle demandée dans les réglages." : safety.reason, res };
  });

  if (out.kind === "pending") {
    await q("UPDATE imports SET status = 'rejected', payload = NULL, reason = 'remplacé par un import plus récent' WHERE status = 'pending' AND kind = 'foxdrive'");
    await q("INSERT INTO imports (kind, source, rows, status, summary, payload, reason) VALUES ('foxdrive', $1, $2, 'pending', $3, $4, $5)",
      [label, parsed.rows.length, JSON.stringify({ added: out.res.added.length, vehicle: out.res.matched.filter((m: any) => m.plateChanged).length, left: out.res.absent.length, probable: out.res.probable.length }), JSON.stringify(parsed), out.reason]);
    await setSetting("sync_state", { ...(await getSetting("sync_state")), hash, lastRunAt: new Date().toISOString(), lastError: "" });
    return { status: "pending", reason: out.reason, rows: parsed.rows.length };
  }
  await setSetting("sync_state", { ...(await getSetting("sync_state")), hash, lastRunAt: new Date().toISOString(), lastOkAt: new Date().toISOString(), lastError: "" });
  if (out.kind === "nochange") return { status: "unchanged", rows: parsed.rows.length, message: "Tout est déjà à jour." };
  return { status: "applied", rows: parsed.rows.length, summary: out.sum };
}

/* ---------------- Contacts nom -> numéro ---------------- */

export async function previewContacts(entries: any[], label: string) {
  if (!entries.length) throw new HttpError(400, "Aucun couple nom / numéro reconnu.");
  const res = await withState((S) => L.reconcileContacts(S, entries));
  const [row] = await q("INSERT INTO imports (kind, source, rows, status, payload) VALUES ('contacts', $1, $2, 'preview', $3) RETURNING id",
    [label, entries.length, JSON.stringify(entries)]);
  return { importId: Number(row.id), label, res };
}

export async function applyContactsImport(importId: number, sel?: Selection) {
  const row = await loadImportPayload(importId, "contacts", ["preview", "pending"]);
  const entries = row.payload as any[];
  const sum = await withState((S) => {
    const res = L.reconcileContacts(S, entries);
    applySelection([...res.assign, ...res.change, ...res.probable], sel);
    if (sel?.assign) res.unmatched.forEach((u: any) => { if (sel.assign![u.key]) u.assignTo = sel.assign![u.key]; });
    const s = L.applyContacts(S, res);
    (S.imports[0] ||= {}).source = row.source;
    return s;
  });
  await q("DELETE FROM imports WHERE id = $1", [importId]);
  return sum;
}

/** Numéros de la feuille : on ajoute ceux qui manquent, sans écraser un numéro existant. */
export async function runContactsSync() {
  const src = await fetchContactsFromSource();
  if (!src) return { status: "skipped" };
  const { entries, label } = src;
  if (!entries.length) return { status: "unchanged" };
  const sum = await withState((S) => {
    const res = L.reconcileContacts(S, entries);
    if (!res.assign.length && !res.change.length) { return null; }
    // automatique : uniquement les numéros valides ajoutés à des chauffeurs sans numéro ; les modifications restent manuelles
    res.change.forEach((i: any) => { i.on = false; });
    res.probable.forEach((i: any) => { i.on = false; });
    const s = L.applyContacts(S, res);
    S.imports[0].source = label + " — auto";
    return s;
  });
  return sum ? { status: "applied", summary: sum } : { status: "unchanged" };
}
