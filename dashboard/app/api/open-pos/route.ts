import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { aggregateOpenQty } from "@/lib/po";
import { secretOk } from "@/lib/secret";

export const dynamic = "force-dynamic";

/**
 * Stock on order = lines of POs this tool generated that nobody has marked received yet (and that are not older than
 * OPEN_PO_DAYS, default 21, so a forgotten PO cannot hide a stockout for ever). The Apps Script feeds this into the
 * rules engine so a SKU that already has an order out is not flagged for another one.
 */
export async function GET(req: Request) {
  if (!secretOk(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "DATABASE_URL not set" }, { status: 500 });
  const days = Number(process.env.OPEN_PO_DAYS) || 21;
  const sql = neon(process.env.DATABASE_URL);
  const rows = await sql`select created_at, received_at, lines from purchase_orders where received_at is null order by created_at desc limit 200`;
  const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));
  const items = aggregateOpenQty(
    rows.map((p) => ({
      created_at: iso(p.created_at), received_at: null,
      lines: (typeof p.lines === "string" ? JSON.parse(p.lines) : p.lines) as { sku: string; qty: number }[],
    })),
    days,
  );
  return NextResponse.json({ configured: true, items: items.map((i) => ({ ...i, expected_date: null })) });
}
