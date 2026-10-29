import type { Config } from "@netlify/functions";
import { dispatch } from "../../server/routes.ts";

export default async (req: Request) => dispatch(req);

export const config: Config = { path: "/api/*" };
