import type { Config } from "@netlify/functions";
import "../../server/env.ts";
import { runContactsSync, runFoxSync } from "../../server/sync.ts";
import { sourceConfigured } from "../../server/sheets.ts";
import { continueAutoSending } from "../../server/campaigns.ts";

// Toutes les 15 minutes (UTC) : relit la feuille Google, met la flotte à jour, reprend les envois automatiques en cours.
export default async () => {
  try {
    if (await sourceConfigured()) {
      try { console.log("sync chauffeurs", JSON.stringify(await runFoxSync({ origin: "auto" }))); } catch (e: any) { console.error("sync chauffeurs :", e?.message || e); }
      try { console.log("sync contacts", JSON.stringify(await runContactsSync())); } catch (e: any) { console.error("sync contacts :", e?.message || e); }
    }
    console.log("envois auto", JSON.stringify(await continueAutoSending()));
  } catch (e) { console.error("sync-cron", e); }
};

export const config: Config = { schedule: "*/15 * * * *" };
