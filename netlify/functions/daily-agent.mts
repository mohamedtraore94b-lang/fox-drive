import type { Config } from "@netlify/functions";
import "../../server/env.ts";
import { dailyRun } from "../../server/campaigns.ts";

// Chaque jour à 07:00 UTC (8 h en hiver, 9 h en été à Paris) : prépare la relance du jour.
export default async () => {
  try { console.log("relance du jour", JSON.stringify(await dailyRun())); } catch (e) { console.error("daily-agent", e); }
};

export const config: Config = { schedule: "0 7 * * *" };
