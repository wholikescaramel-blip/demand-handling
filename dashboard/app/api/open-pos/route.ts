import { NextResponse } from "next/server";
import { secretOk } from "@/lib/secret";
import { listOpenPoQty, zohoCfg } from "@/lib/zoho";

export const dynamic = "force-dynamic";

/** Apps Script pulls stock-on-order from Zoho through here, so Zoho credentials never leave the dashboard. */
export async function GET(req: Request) {
  if (!secretOk(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const cfg = zohoCfg();
  if (!cfg) return NextResponse.json({ configured: false, items: [] });
  try {
    return NextResponse.json({ configured: true, items: await listOpenPoQty(cfg) });
  } catch (e) {
    return NextResponse.json({ configured: true, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
