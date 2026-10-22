import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { secretOk } from "@/lib/secret";

export const dynamic = "force-dynamic";

/** For the daily SLA nudge: how many recommendations are still waiting, and are they past the 24h due time? */
export async function GET(req: Request) {
  if (!secretOk(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "DATABASE_URL not set" }, { status: 500 });
  const sql = neon(process.env.DATABASE_URL);
  const [row] = await sql`
    select u.run_id, u.review_due_at,
           (select count(*) from recommendations r
             where r.run_id = u.run_id
               and not exists (select 1 from decisions d where d.run_id = r.run_id and d.sku = r.sku)) as pending
    from runs u where u.status = 'OK' and u.mode = 'LIVE' order by u.run_at desc limit 1`;
  if (!row) return NextResponse.json({ pending: 0, overdue: false, run_id: null, due_at: null });
  const due = row.review_due_at ? new Date(row.review_due_at) : null;
  const pending = Number(row.pending);
  return NextResponse.json({
    run_id: row.run_id, pending, due_at: due ? due.toISOString() : null, overdue: pending > 0 && due !== null && due.getTime() < Date.now(),
  });
}
