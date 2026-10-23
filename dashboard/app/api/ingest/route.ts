import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { z } from "zod";
import { timingSafeEqual } from "@/lib/auth";
import { generatePosForReady } from "@/lib/orders";

export const dynamic = "force-dynamic";

const nint = z.number().nullable().optional();
const nstr = z.string().nullable().optional();

const Run = z.object({
  run_id: z.string().min(1),
  run_at: z.string().min(1),
  as_of: nstr, mode: nstr,
  status: z.string().default("OK"),
  skus: nint, completeness: nint, flagged: nint, healthy: nint,
  n_reorder: z.number().default(0), n_pause: z.number().default(0), n_manual: z.number().default(0),
  festival: z.boolean().nullable().optional(),
  gemini_reasons: nstr, gemini_tokens: z.number().default(0), summary: nstr, notes: nstr,
  review_due_at: nstr,
});
const Rec = z.object({
  sku: z.string(), name: nstr, perishable: z.boolean().nullable().optional(), action: z.string(),
  rec_qty: nint, priority: nint, on_hand: nint, open_po: nint, cover_weeks: nint, trend_pct: nint,
  flags: nstr, reason: nstr, reason_source: nstr, data_notes: nstr,
  distributor_id: nstr, distributor_name: nstr,
  unit: nstr, hsn: nstr, unit_cost: nint, tax_pct: nint,
});
const Vendor = z.object({ key: z.string().min(1), name: nstr, region: nstr, address: nstr, gstin: nstr, contact: nstr, email: nstr });
const Decision = z.object({
  decided_at: z.string(), run_id: z.string(), sku: z.string(), action: nstr, rec_qty: nint, flags: nstr, priority: nint,
  decision: z.string(), final_qty: nint, reason: nstr, reviewer: nstr, hours_to_decide: nint,
});
const RuleReview = z.object({
  opened_at: z.string(), rule: z.string(), changed: nint, total: nint, rate: nstr, proposal: nstr, status: z.string().default("OPEN"),
});

const Body = z.discriminatedUnion("type", [
  z.object({ type: z.literal("run"), run: Run, recs: z.array(Rec).default([]), vendors: z.array(Vendor).default([]) }),
  z.object({ type: z.literal("decisions"), decisions: z.array(Decision) }),
  z.object({ type: z.literal("rule_reviews"), items: z.array(RuleReview) }),
]);

/** Apps Script pushes here after each run, finalise and rule review. Idempotent (upserts). */
export async function POST(req: Request) {
  const secret = process.env.SYNC_SECRET;
  const given = req.headers.get("x-sync-secret") ?? "";
  if (!secret || !timingSafeEqual(given, secret)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "DATABASE_URL not set" }, { status: 500 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad payload", issues: parsed.error.issues.slice(0, 5) }, { status: 400 });
  const body = parsed.data;
  const sql = neon(process.env.DATABASE_URL);

  if (body.type === "run") {
    const r = body.run;
    await sql`
      insert into runs (run_id, run_at, as_of, mode, status, skus, completeness, flagged, healthy, n_reorder, n_pause, n_manual,
                        festival, gemini_reasons, gemini_tokens, summary, notes, review_due_at)
      values (${r.run_id}, ${r.run_at}, ${r.as_of ?? null}, ${r.mode ?? null}, ${r.status}, ${r.skus ?? null}, ${r.completeness ?? null},
              ${r.flagged ?? null}, ${r.healthy ?? null}, ${r.n_reorder}, ${r.n_pause}, ${r.n_manual}, ${r.festival ?? null},
              ${r.gemini_reasons ?? null}, ${r.gemini_tokens}, ${r.summary ?? null}, ${r.notes ?? null}, ${r.review_due_at ?? null})
      on conflict (run_id) do update set
        run_at = excluded.run_at, as_of = excluded.as_of, mode = excluded.mode, status = excluded.status, skus = excluded.skus,
        completeness = excluded.completeness, flagged = excluded.flagged, healthy = excluded.healthy,
        n_reorder = excluded.n_reorder, n_pause = excluded.n_pause, n_manual = excluded.n_manual, festival = excluded.festival,
        gemini_reasons = excluded.gemini_reasons, gemini_tokens = excluded.gemini_tokens, summary = excluded.summary, notes = excluded.notes,
        review_due_at = excluded.review_due_at`;
    for (const c of body.recs) {
      await sql`
        insert into recommendations (run_id, sku, name, perishable, action, rec_qty, priority, on_hand, open_po, cover_weeks,
                                     trend_pct, flags, reason, reason_source, data_notes, distributor_id, distributor_name,
                                     unit, hsn, unit_cost, tax_pct)
        values (${r.run_id}, ${c.sku}, ${c.name ?? null}, ${c.perishable ?? null}, ${c.action}, ${c.rec_qty ?? null}, ${c.priority ?? null},
                ${c.on_hand ?? null}, ${c.open_po ?? null}, ${c.cover_weeks ?? null}, ${c.trend_pct ?? null}, ${c.flags ?? null},
                ${c.reason ?? null}, ${c.reason_source ?? null}, ${c.data_notes ?? null}, ${c.distributor_id ?? null}, ${c.distributor_name ?? null},
                ${c.unit ?? null}, ${c.hsn ?? null}, ${c.unit_cost ?? null}, ${c.tax_pct ?? null})
        on conflict (run_id, sku) do update set
          name = excluded.name, perishable = excluded.perishable, action = excluded.action, rec_qty = excluded.rec_qty,
          priority = excluded.priority, on_hand = excluded.on_hand, open_po = excluded.open_po, cover_weeks = excluded.cover_weeks,
          trend_pct = excluded.trend_pct, flags = excluded.flags, reason = excluded.reason, reason_source = excluded.reason_source,
          data_notes = excluded.data_notes, distributor_id = excluded.distributor_id, distributor_name = excluded.distributor_name,
          unit = excluded.unit, hsn = excluded.hsn, unit_cost = excluded.unit_cost, tax_pct = excluded.tax_pct`;
    }
    for (const v of body.vendors) {
      await sql`
        insert into vendors (vendor_key, name, region, address, gstin, contact, email)
        values (${v.key}, ${v.name ?? null}, ${v.region ?? null}, ${v.address ?? null}, ${v.gstin ?? null}, ${v.contact ?? null}, ${v.email ?? null})
        on conflict (vendor_key) do update set
          name = excluded.name, region = excluded.region, address = excluded.address, gstin = excluded.gstin,
          contact = excluded.contact, email = excluded.email`;
    }
    // A new live run closes anything the previous live run left undecided, so it is counted rather than lost.
    if (r.mode === "LIVE" && r.status === "OK") {
      await sql`
        insert into decisions (decided_at, run_id, sku, action, rec_qty, flags, priority, decision, reason, po_status)
        select now(), c.run_id, c.sku, c.action, c.rec_qty, c.flags, c.priority, 'EXPIRED', 'Not decided before the next run', 'NONE'
        from recommendations c join runs u on u.run_id = c.run_id
        where u.mode = 'LIVE' and c.run_id <> ${r.run_id}
          and not exists (select 1 from decisions d where d.run_id = c.run_id and d.sku = c.sku)
        on conflict (run_id, sku) do nothing`;
      // Approved lines left over from an incomplete review still get their purchase orders.
      await generatePosForReady();
    }
    return NextResponse.json({ ok: true, run: r.run_id, recs: body.recs.length });
  }

  if (body.type === "decisions") {
    for (const d of body.decisions) {
      await sql`
        insert into decisions (decided_at, run_id, sku, action, rec_qty, flags, priority, decision, final_qty, reason, reviewer, hours_to_decide)
        values (${d.decided_at}, ${d.run_id}, ${d.sku}, ${d.action ?? null}, ${d.rec_qty ?? null}, ${d.flags ?? null}, ${d.priority ?? null},
                ${d.decision}, ${d.final_qty ?? null}, ${d.reason ?? null}, ${d.reviewer ?? null}, ${d.hours_to_decide ?? null})
        on conflict (run_id, sku) do update set
          decided_at = excluded.decided_at, decision = excluded.decision, final_qty = excluded.final_qty, reason = excluded.reason,
          reviewer = excluded.reviewer, hours_to_decide = excluded.hours_to_decide`;
    }
    return NextResponse.json({ ok: true, decisions: body.decisions.length });
  }

  for (const i of body.items) {
    await sql`
      insert into rule_reviews (opened_at, rule, changed, total, rate, proposal, status)
      values (${i.opened_at}, ${i.rule}, ${i.changed ?? null}, ${i.total ?? null}, ${i.rate ?? null}, ${i.proposal ?? null}, ${i.status})
      on conflict (opened_at, rule) do update set
        changed = excluded.changed, total = excluded.total, rate = excluded.rate, proposal = excluded.proposal, status = excluded.status`;
  }
  return NextResponse.json({ ok: true, items: body.items.length });
}
