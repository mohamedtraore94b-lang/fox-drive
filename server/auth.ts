import "./env.ts";
import { q } from "./db.ts";
import { HttpError, hashPassword, safeEqual, signToken, verifyPassword, verifyToken } from "./crypto.ts";

export const COOKIE = "fd_session";
const SESSION_DAYS = 30;
const MAX_FAILS = 8;           // par e-mail, sur 15 minutes

export type User = { id: number; email: string; name: string; role: string };

function env(name: string): string | undefined {
  return (globalThis as any).Netlify?.env?.get?.(name) ?? process.env[name];
}

export function readCookie(req: Request, name = COOKIE): string {
  const h = req.headers.get("cookie") || "";
  for (const p of h.split(/;\s*/)) { const i = p.indexOf("="); if (i > 0 && p.slice(0, i) === name) return decodeURIComponent(p.slice(i + 1)); }
  return "";
}

export function sessionCookie(token: string | null, secure = true): string {
  const base = `${COOKIE}=${token ? encodeURIComponent(token) : ""}; Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
  return token ? `${base}; Max-Age=${SESSION_DAYS * 86400}` : `${base}; Max-Age=0`;
}

export async function currentUser(req: Request): Promise<User | null> {
  const p = verifyToken<{ uid: number }>(readCookie(req));
  if (!p) return null;
  const [u] = await q("SELECT id, email, name, role FROM users WHERE id = $1", [p.uid]);
  return u || null;
}

export async function usersExist(): Promise<boolean> {
  const [r] = await q("SELECT count(*)::int AS n FROM users");
  return r.n > 0;
}

function validEmail(e: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }
function validPassword(p: string) { return typeof p === "string" && p.length >= 10; }

/** Création du premier compte : protégée par le code SETUP_CODE (variable d'environnement). */
export async function setupAdmin(body: any): Promise<User> {
  if (await usersExist()) throw new HttpError(403, "Un compte existe déjà.");
  const code = env("SETUP_CODE");
  if (!code) throw new HttpError(500, "SETUP_CODE n'est pas défini dans les variables d'environnement.");
  if (!safeEqual(String(body.code || ""), code)) throw new HttpError(403, "Code d'installation incorrect.");
  const email = String(body.email || "").trim().toLowerCase();
  if (!validEmail(email)) throw new HttpError(400, "Adresse e-mail invalide.");
  if (!validPassword(body.password)) throw new HttpError(400, "Mot de passe : 10 caractères minimum.");
  const [u] = await q("INSERT INTO users (email, name, password_hash, role) VALUES ($1,$2,$3,'admin') RETURNING id, email, name, role",
    [email, String(body.name || "").trim(), hashPassword(body.password)]);
  return u;
}

export async function login(emailRaw: string, password: string, ip: string): Promise<{ user: User; token: string }> {
  const email = String(emailRaw || "").trim().toLowerCase();
  const [f] = await q("SELECT count(*)::int AS n FROM login_attempts WHERE email = $1 AND NOT ok AND created_at > now() - interval '15 minutes'", [email]);
  if (f.n >= MAX_FAILS) throw new HttpError(429, "Trop de tentatives. Réessaie dans 15 minutes.");
  const [u] = await q("SELECT id, email, name, role, password_hash FROM users WHERE email = $1", [email]);
  const ok = !!u && verifyPassword(String(password || ""), u.password_hash);
  await q("INSERT INTO login_attempts (email, ip, ok) VALUES ($1,$2,$3)", [email, ip || "", ok]);
  if (!ok) throw new HttpError(401, "E-mail ou mot de passe incorrect.");
  await q("DELETE FROM login_attempts WHERE created_at < now() - interval '30 days'");
  return { user: { id: u.id, email: u.email, name: u.name, role: u.role }, token: signToken({ uid: u.id }, SESSION_DAYS * 86400) };
}

export async function changePassword(userId: number, oldPw: string, newPw: string) {
  const [u] = await q("SELECT password_hash FROM users WHERE id = $1", [userId]);
  if (!u || !verifyPassword(oldPw, u.password_hash)) throw new HttpError(403, "Mot de passe actuel incorrect.");
  if (!validPassword(newPw)) throw new HttpError(400, "Nouveau mot de passe : 10 caractères minimum.");
  await q("UPDATE users SET password_hash = $1 WHERE id = $2", [hashPassword(newPw), userId]);
}

export async function addUser(body: any): Promise<User> {
  const email = String(body.email || "").trim().toLowerCase();
  if (!validEmail(email)) throw new HttpError(400, "Adresse e-mail invalide.");
  if (!validPassword(body.password)) throw new HttpError(400, "Mot de passe : 10 caractères minimum.");
  const role = body.role === "viewer" ? "viewer" : "admin";
  try {
    const [u] = await q("INSERT INTO users (email, name, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING id, email, name, role",
      [email, String(body.name || "").trim(), hashPassword(body.password), role]);
    return u;
  } catch (e: any) {
    if (String(e?.message).includes("unique")) throw new HttpError(409, "Cette adresse existe déjà.");
    throw e;
  }
}
