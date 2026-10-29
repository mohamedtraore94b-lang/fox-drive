import "./env.ts";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

function appSecret(): string {
  const s = (globalThis as any).Netlify?.env?.get?.("APP_SECRET") ?? process.env.APP_SECRET;
  if (!s || String(s).length < 16) throw new HttpError(500, "APP_SECRET manquant (variable d'environnement, 16 caractères minimum).");
  return String(s);
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

const key = () => createHash("sha256").update("fox-drive:enc:" + appSecret()).digest();

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), ct.toString("base64")].join(":");
}
export function decrypt(blob: string): string {
  const [v, iv, tag, ct] = blob.split(":");
  if (v !== "v1") throw new Error("format chiffré inconnu");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8");
}

export function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  const h = scryptSync(pw, salt, 64);
  return "scrypt$" + salt.toString("base64") + "$" + h.toString("base64");
}
export function verifyPassword(pw: string, stored: string): boolean {
  const [alg, salt, hash] = String(stored).split("$");
  if (alg !== "scrypt" || !salt || !hash) return false;
  const h = scryptSync(pw, Buffer.from(salt, "base64"), 64);
  const ref = Buffer.from(hash, "base64");
  return h.length === ref.length && timingSafeEqual(h, ref);
}

const b64u = (b: Buffer) => b.toString("base64url");
export function signToken(payload: object, ttlSeconds: number): string {
  const body = b64u(Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds })));
  const sig = b64u(createHmac("sha256", appSecret()).update("sess:" + body).digest());
  return body + "." + sig;
}
export function verifyToken<T = any>(token: string): (T & { exp: number }) | null {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig) return null;
  const good = b64u(createHmac("sha256", appSecret()).update("sess:" + body).digest());
  const a = Buffer.from(sig), b = Buffer.from(good);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!p.exp || p.exp < Date.now() / 1000) return null;
    return p;
  } catch { return null; }
}
export function hmacHex(secret: string, data: string | Buffer): string {
  return createHmac("sha256", secret).update(data).digest("hex");
}
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function randomToken(n = 24): string { return randomBytes(n).toString("base64url"); }
