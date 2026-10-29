/* Serveur local de test : base Postgres jetable (NetlifyDB) + API + fichiers statiques.
   Usage : node scripts/dev-server.ts   (puis http://localhost:8899) */
import "../server/env.ts";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { NetlifyDB } from "@netlify/database-dev";
import pg from "pg";
import { setPool } from "../server/db.ts";

process.env.APP_SECRET ||= "dev-secret-dev-secret-1234";
process.env.SETUP_CODE ||= "dev-setup";
const ndb = new NetlifyDB();
const cs = await ndb.start();
await ndb.applyMigrations("./netlify/database/migrations");
setPool(new pg.Pool({ connectionString: cs }));
const { dispatch } = await import("../server/routes.ts");
const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json", ".json": "application/json" };
const port = Number(process.env.PORT) || 8899;
http.createServer(async (rq, rs) => {
  const url = new URL(rq.url || "/", "http://localhost:" + port);
  if (url.pathname.startsWith("/api/")) {
    const chunks: Buffer[] = []; for await (const c of rq) chunks.push(c as Buffer);
    const headers = new Headers(); for (const [k, v] of Object.entries(rq.headers)) if (v) headers.set(k, Array.isArray(v) ? v.join(",") : v);
    const body = ["GET", "HEAD"].includes(rq.method || "GET") ? undefined : Buffer.concat(chunks);
    const r = await dispatch(new Request(url, { method: rq.method, headers, body }));
    const out: Record<string, string> = {}; r.headers.forEach((v, k) => { out[k] = v; });
    rs.writeHead(r.status, out); rs.end(Buffer.from(await r.arrayBuffer())); return;
  }
  let f = path.join("public", url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname));
  if (!f.startsWith("public") || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rs.writeHead(404); rs.end("404"); return; }
  rs.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream", "cache-control": "no-cache" }); rs.end(fs.readFileSync(f));
}).listen(port, () => console.log("ready http://localhost:" + port));
