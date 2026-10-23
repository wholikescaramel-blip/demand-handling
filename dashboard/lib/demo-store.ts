import { cookies } from "next/headers";
import type { DemoDecision } from "./demo-apply.ts";

export const DEMO_COOKIE = "dp_demo";

export async function readDemoDecisions(): Promise<DemoDecision[]> {
  const raw = (await cookies()).get(DEMO_COOKIE)?.value;
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v)
      ? v.filter((d) => d && typeof d.run_id === "string" && typeof d.sku === "string" && ["Approve", "Override", "Reject"].includes(d.decision))
      : [];
  } catch {
    return [];
  }
}

export async function writeDemoDecisions(list: DemoDecision[]) {
  (await cookies()).set(DEMO_COOKIE, JSON.stringify(list), { path: "/", maxAge: 60 * 60 * 24 * 7, httpOnly: true, sameSite: "lax" });
}

export async function clearDemoDecisions() {
  (await cookies()).delete(DEMO_COOKIE);
}
