import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { secretOk } from "@/lib/secret";

export const dynamic = "force-dynamic";

/** Apps Script mirrors decisions (and PO numbers) back into the Sheet so the Sheet stays the system of record. */
export async function GET(req: Request) {
  if (!secretOk(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "DATABASE_URL not set" }, { status: 500 });
  const days = Math.min(365, Math.max(1, Number(new URL(req.url).searchParams.get("days")) || 90));
  const sql = neon(process.env.DATABASE_URL);
  const rows = await sql`
    select d.*, r.name
    from decisions d left join recommendations r on r.run_id = d.run_id and r.sku = d.sku
    where d.decided_at >= now() - (${days} * interval '1 day')
    order by d.decided_at`;
  const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v ? String(v) : null);
  return NextResponse.json({
    decisions: rows.map((d) => ({
      decided_at: iso(d.decided_at), run_id: d.run_id, sku: d.sku, name: d.name ?? null, action: d.action, rec_qty: d.rec_qty,
      flags: d.flags, priority: d.priority, decision: d.decision, final_qty: d.final_qty, reason: d.reason, reviewer: d.reviewer,
      hours_to_decide: d.hours_to_decide, po_status: d.po_status, po_number: d.po_number, po_created_at: iso(d.po_created_at),
    })),
  });
}
