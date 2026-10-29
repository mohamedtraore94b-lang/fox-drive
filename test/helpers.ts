import "../server/env.ts";
import { NetlifyDB } from "@netlify/database-dev";
import pg from "pg";
import { setPool } from "../server/db.ts";

process.env.APP_SECRET = process.env.APP_SECRET || "test-secret-test-secret-1234";

let ndb: any = null, pool: any = null;
export async function startDb() {
  ndb = new NetlifyDB();
  const cs = await ndb.start();
  await ndb.applyMigrations("./netlify/database/migrations");
  pool = new pg.Pool({ connectionString: cs });
  setPool(pool);
  return pool;
}
export async function resetDb() {
  await pool.query("TRUNCATE drivers, contacts, events, imports, campaigns, campaign_items, messages, settings, users, login_attempts, agent_runs RESTART IDENTITY CASCADE");
}
export async function stopDb() { await pool?.end(); await ndb?.stop(); }
