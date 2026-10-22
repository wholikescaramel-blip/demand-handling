import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { z } from "zod";
import { secretOk } from "@/lib/secret";

export const dynamic = "force-dynamic";

/** Apps Script asks for POs it has not filed yet, then marks them delivered once it has saved and emailed the PDF. */
export async function GET(req: Request) {
  if (!secretOk(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "DATABASE_URL not set" }, { status: 500 });
  const sql = neon(process.env.DATABASE_URL);
  const rows = await sql`
    select po_number, created_at, vendor_key, vendor_name, run_ids, created_by, total_qty, lines
    from purchase_orders where delivered_at is null order by created_at limit 50`;
  const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));
  return NextResponse.json({
    pos: rows.map((p) => ({
      po_number: p.po_number, created_at: iso(p.created_at), vendor_key: p.vendor_key, vendor_name: p.vendor_name,
      run_ids: p.run_ids, created_by: p.created_by, total_qty: Number(p.total_qty),
      lines: typeof p.lines === "string" ? JSON.parse(p.lines) : p.lines,
    })),
  });
}

const Body = z.object({ po_numbers: z.array(z.string().min(1)).min(1).max(100) });

export async function POST(req: Request) {
  if (!secretOk(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "DATABASE_URL not set" }, { status: 500 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad payload" }, { status: 400 });
  const sql = neon(process.env.DATABASE_URL);
  for (const n of parsed.data.po_numbers) {
    await sql`update purchase_orders set delivered_at = now() where po_number = ${n} and delivered_at is null`;
  }
  return NextResponse.json({ ok: true, marked: parsed.data.po_numbers.length });
}
