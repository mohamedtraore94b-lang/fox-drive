import "./env.ts";
import { HttpError } from "./crypto.ts";

export type Ctx = { req: Request; url: URL; params: Record<string, string>; body: any; user: any | null };
type Handler = (c: Ctx) => Promise<any> | any;
type Route = { method: string; re: RegExp; keys: string[]; h: Handler; auth: "none" | "user" | "admin" };

const routes: Route[] = [];

export function route(method: string, path: string, auth: Route["auth"], h: Handler) {
  const keys: string[] = [];
  const re = new RegExp("^" + path.replace(/:([a-zA-Z]+)/g, (_m, k) => { keys.push(k); return "([^/]+)"; }) + "/?$");
  routes.push({ method, re, keys, h, auth });
}

export function json(data: any, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
}

export function match(method: string, pathname: string) {
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = pathname.match(r.re);
    if (m) { const params: Record<string, string> = {}; r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1]))); return { r, params }; }
  }
  return null;
}

export function pathExists(pathname: string) { return routes.some((r) => r.re.test(pathname)); }

export async function readBody(req: Request) {
  if (req.method === "GET" || req.method === "HEAD") return null;
  const t = await req.text();
  if (!t) return {};
  try { return JSON.parse(t); } catch { throw new HttpError(400, "Corps de requête invalide (JSON attendu)."); }
}

export function clientIp(req: Request): string {
  return req.headers.get("x-nf-client-connection-ip") || (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "";
}
