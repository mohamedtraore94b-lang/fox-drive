import type { Config } from "@netlify/functions";
import "../../server/env.ts";
import { hmacHex, safeEqual } from "../../server/crypto.ts";
import { waConfig, handleWebhookPayload } from "../../server/whatsapp.ts";

export default async (req: Request) => {
  const cfg = await waConfig();
  const url = new URL(req.url);
  if (req.method === "GET") {
    // vérification demandée par Meta quand tu enregistres l'URL du webhook
    if (cfg?.verifyToken && url.searchParams.get("hub.mode") === "subscribe" && safeEqual(url.searchParams.get("hub.verify_token") || "", cfg.verifyToken)) {
      return new Response(url.searchParams.get("hub.challenge") || "", { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const raw = await req.text();
  if (!cfg?.appSecret) return new Response("App secret manquant", { status: 403 });
  const sig = (req.headers.get("x-hub-signature-256") || "").replace(/^sha256=/, "");
  if (!sig || !safeEqual(sig, hmacHex(cfg.appSecret, raw))) return new Response("Signature invalide", { status: 403 });
  try { await handleWebhookPayload(JSON.parse(raw)); } catch (e) { console.error("webhook", e); return new Response("error", { status: 500 }); }
  return new Response("ok", { status: 200 });
};

export const config: Config = { path: "/webhooks/whatsapp" };
