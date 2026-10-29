import "./env.ts";
import { getDatabase } from "@netlify/database";

let override: any = null;
/** Tests : injecte un pool Postgres local. */
export function setPool(p: any) { override = p; }

export function pool(): any {
  if (override) return override;
  return getDatabase().pool;
}

export async function q<T = any>(text: string, params: any[] = []): Promise<T[]> {
  const r = await pool().query(text, params);
  return r.rows as T[];
}

export async function tx<T>(fn: (c: any) => Promise<T>): Promise<T> {
  const c = await pool().connect();
  try {
    await c.query("BEGIN");
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (e) {
    try { await c.query("ROLLBACK"); } catch { /* ignore */ }
    throw e;
  } finally {
    c.release();
  }
}
