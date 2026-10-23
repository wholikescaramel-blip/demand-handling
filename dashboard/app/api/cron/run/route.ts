import { NextResponse } from "next/server";
import { runPlanning } from "@/lib/planning";
import { dbConfigured } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Twice a week (see vercel.json) Vercel calls this to run the planning. Vercel sends "Authorization: Bearer <CRON_SECRET>"
 * when a CRON_SECRET environment variable is set; without it the route refuses to run, so nobody else can trigger it.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!dbConfigured()) return NextResponse.json({ error: "DATABASE_URL not set" }, { status: 500 });
  const result = await runPlanning("scheduled run");
  return NextResponse.json(result, { status: result.ok ? 200 : 422 });
}
