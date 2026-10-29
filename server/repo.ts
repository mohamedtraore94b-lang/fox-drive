import "./env.ts";
import { pool, q } from "./db.ts";
import * as L from "../public/lib.js";

const D = (c: string) => `to_char(${c}, 'YYYY-MM-DD')`;
const TS = (c: string) => `CASE WHEN ${c} IS NULL THEN NULL ELSE to_char(${c} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END`;

export const DRIVER_SELECT = `id, name, phone, plate, vehicle, manager,
  ${D("pickup")} AS "pickup", pickup_estimated AS "pickupEstimated",
  ${D("last_verif")} AS "lastVerif", ${D("last_checkin")} AS "lastCheckin",
  ${TS("last_contacted")} AS "lastContacted", status, ${D("absent_since")} AS "absentSince",
  prev_plate AS "prevPlate", source, notes`;

export type State = {
  drivers: any[]; contacts: Record<string, { name: string; phone: string }>;
  log: any[]; imports: any[]; lastFox?: string | null; lastContacts?: string | null;
};

/** Les dates métier sont des jours (heure de Paris) : un horodatage ISO est ramené à sa date locale. */
function dateOnly(v: any): string | null {
  if (!v) return null;
  const s = String(v);
  if (s.length <= 10) return s;
  const dt = new Date(s);
  return isNaN(+dt) ? s.slice(0, 10) : L.toISO(dt);
}

function clean(d: any) {
  return {
    id: d.id, name: d.name, phone: d.phone || "", plate: d.plate || "", vehicle: d.vehicle || "", manager: d.manager || "",
    pickup: dateOnly(d.pickup), pickupEstimated: !!d.pickupEstimated, lastVerif: dateOnly(d.lastVerif), lastCheckin: dateOnly(d.lastCheckin),
    lastContacted: d.lastContacted || null, status: d.status || "active", absentSince: dateOnly(d.absentSince),
    prevPlate: d.prevPlate || null, source: d.source || "", notes: d.notes || "",
  };
}

export async function loadDrivers(client?: any): Promise<any[]> {
  const run = client ? (t: string, p?: any[]) => client.query(t, p).then((r: any) => r.rows) : q;
  const rows = await run(`SELECT ${DRIVER_SELECT} FROM drivers ORDER BY id`);
  return rows.map((r: any) => { const d = clean(r); if (!d.prevPlate) delete (d as any).prevPlate; return d; });
}

export async function loadContacts(client?: any) {
  const run = client ? (t: string, p?: any[]) => client.query(t, p).then((r: any) => r.rows) : q;
  const rows = await run("SELECT name_key, name, phone FROM contacts");
  const book: Record<string, { name: string; phone: string }> = {};
  rows.forEach((r: any) => { book[r.name_key] = { name: r.name, phone: r.phone }; });
  return book;
}

export async function loadEvents(limit = 300, driverId?: number) {
  const rows = await q(
    `SELECT id, ${TS("ts")} AS ts, type, driver_id AS "id_", name, text, meta FROM events
     ${driverId ? "WHERE driver_id = $2" : ""} ORDER BY ts DESC, id DESC LIMIT $1`,
    driverId ? [limit, driverId] : [limit]);
  return rows.map((r: any) => ({ ...(r.meta || {}), eid: Number(r.id), ts: r.ts, type: r.type, id: r.id_, name: r.name, text: r.text }));
}

export async function loadImports(limit = 40) {
  const rows = await q(
    `SELECT id, ${TS("ts")} AS ts, kind, source, rows, status, summary, reason FROM imports
     WHERE status IN ('applied','pending','rejected') ORDER BY ts DESC, id DESC LIMIT $1`, [limit]);
  return rows.map((r: any) => ({ id: Number(r.id), ts: r.ts, kind: r.kind, source: r.source, rows: r.rows, status: r.status, summary: r.summary, reason: r.reason }));
}

/** Vue complète pour l'interface (même forme que l'ancien état local). */
export async function loadStateView() {
  const [drivers, contacts, log, imports] = await Promise.all([loadDrivers(), loadContacts(), loadEvents(300), loadImports(40)]);
  const lastFox = imports.find((i: any) => i.kind === "foxdrive" && i.status === "applied")?.ts || null;
  const lastContacts = imports.find((i: any) => i.kind === "contacts" && i.status === "applied")?.ts || null;
  const pending = imports.filter((i: any) => i.status === "pending");
  return { v: 5, drivers, contacts, log, imports, lastFox, lastContacts, pending };
}

/**
 * Exécute `fn` sur un état en mémoire, sous verrou, puis enregistre uniquement ce qui a changé.
 * Les règles métier (public/lib.js) restent identiques à l'ancienne app ; la base est la seule source de vérité.
 * state.log et state.imports démarrent vides : tout ce que la logique y ajoute est inséré en base.
 */
export async function withState<T>(fn: (S: State) => Promise<T> | T): Promise<T> {
  const c = await pool().connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(424242)");
    const drivers = await loadDrivers(c);
    const contacts = await loadContacts(c);
    const S: State = { drivers, contacts, log: [], imports: [] };
    const beforeD = new Map(drivers.map((d) => [d.id, JSON.stringify(clean(d))]));
    const beforeC = new Map(Object.entries(contacts).map(([k, v]) => [k, JSON.stringify(v)]));

    const out = await fn(S);

    for (const d of S.drivers) {
      const cd = clean(d);
      const js = JSON.stringify(cd);
      if (beforeD.get(d.id) === js) continue;
      await c.query(
        `INSERT INTO drivers (id, name, name_key, phone, plate, vehicle, manager, pickup, pickup_estimated, last_verif, last_checkin,
           last_contacted, status, absent_since, prev_plate, source, notes, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17, now())
         ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, name_key=EXCLUDED.name_key, phone=EXCLUDED.phone, plate=EXCLUDED.plate,
           vehicle=EXCLUDED.vehicle, manager=EXCLUDED.manager, pickup=EXCLUDED.pickup, pickup_estimated=EXCLUDED.pickup_estimated,
           last_verif=EXCLUDED.last_verif, last_checkin=EXCLUDED.last_checkin, last_contacted=EXCLUDED.last_contacted,
           status=EXCLUDED.status, absent_since=EXCLUDED.absent_since, prev_plate=EXCLUDED.prev_plate, source=EXCLUDED.source,
           notes=EXCLUDED.notes, updated_at=now()`,
        [cd.id, cd.name, L.nameKey(cd.name), cd.phone, cd.plate, cd.vehicle, cd.manager, cd.pickup, cd.pickupEstimated, cd.lastVerif,
          cd.lastCheckin, cd.lastContacted, cd.status, cd.absentSince, cd.prevPlate, cd.source, cd.notes]);
    }
    const present = new Set(S.drivers.map((d) => d.id));
    for (const id of beforeD.keys()) if (!present.has(id)) await c.query("DELETE FROM drivers WHERE id = $1", [id]);
    for (const [k, v] of Object.entries(S.contacts)) {
      if (beforeC.get(k) === JSON.stringify(v)) continue;
      await c.query(
        `INSERT INTO contacts (name_key, name, phone, updated_at) VALUES ($1,$2,$3, now())
         ON CONFLICT (name_key) DO UPDATE SET name=EXCLUDED.name, phone=EXCLUDED.phone, updated_at=now()`, [k, v.name, v.phone]);
    }
    for (const k of beforeC.keys()) if (!(k in S.contacts)) await c.query("DELETE FROM contacts WHERE name_key = $1", [k]);

    // journal : le plus ancien d'abord pour garder l'ordre chronologique
    for (const e of [...S.log].reverse()) {
      const { ts, type, id, name, text, ...meta } = e;
      await c.query("INSERT INTO events (ts, type, driver_id, name, text, meta) VALUES ($1,$2,$3,$4,$5,$6)",
        [ts || new Date().toISOString(), type, id ?? null, name || "", text || "", JSON.stringify(meta || {})]);
    }
    for (const i of [...S.imports].reverse()) {
      await c.query("INSERT INTO imports (ts, kind, source, rows, status, summary) VALUES ($1,$2,$3,$4,'applied',$5)",
        [i.ts || new Date().toISOString(), i.kind, i.source || "", i.rows || 0, JSON.stringify(i.summary || {})]);
    }
    await c.query("COMMIT");
    return out;
  } catch (e) {
    try { await c.query("ROLLBACK"); } catch { /* ignore */ }
    throw e;
  } finally {
    c.release();
  }
}

export async function addEvent(type: string, driver: any, text: string, meta: any = {}) {
  await q("INSERT INTO events (type, driver_id, name, text, meta) VALUES ($1,$2,$3,$4,$5)",
    [type, driver?.id ?? null, driver?.name || "", text, JSON.stringify(meta)]);
}
