import { neon } from "@neondatabase/serverless";
import demo from "./demo-data.json";
import type { Decision, Rec, Run, RuleReview, Snapshot } from "./types.ts";

export const hasDb = () => Boolean(process.env.DATABASE_URL);

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** Everything the pages need, in one place. Falls back to bundled demo data when DATABASE_URL is not set. */
export async function getSnapshot(): Promise<Snapshot> {
  if (!hasDb()) return demo as unknown as Snapshot;

  const sql = neon(process.env.DATABASE_URL!);
  const [runRows, decisionRows, reviewRows] = await Promise.all([
    sql`select * from runs order by run_at desc limit 40`,
    sql`select d.*, r.name from decisions d left join recommendations r on r.run_id = d.run_id and r.sku = d.sku order by d.decided_at desc limit 500`,
    sql`select * from rule_reviews order by opened_at desc limit 50`,
  ]);

  const runs: Run[] = runRows.map((r) => ({
    run_id: r.run_id, run_at: iso(r.run_at), as_of: r.as_of, mode: r.mode, status: r.status,
    skus: num(r.skus), completeness: num(r.completeness), flagged: num(r.flagged), healthy: num(r.healthy),
    n_reorder: Number(r.n_reorder), n_pause: Number(r.n_pause), n_manual: Number(r.n_manual),
    festival: r.festival, gemini_reasons: r.gemini_reasons, gemini_tokens: Number(r.gemini_tokens),
    summary: r.summary, notes: r.notes, review_due_at: r.review_due_at ? iso(r.review_due_at) : null,
  }));
  const latestRun = runs.find((r) => r.status === "OK") ?? null;

  let recs: Rec[] = [];
  if (latestRun) {
    const rows = await sql`
      select r.*, d.decision, d.final_qty, d.reason as change_reason, d.po_status, d.po_number
      from recommendations r
      left join decisions d on d.run_id = r.run_id and d.sku = r.sku
      where r.run_id = ${latestRun.run_id}
      order by r.priority desc nulls last`;
    recs = rows.map((r) => ({
      run_id: r.run_id, sku: r.sku, name: r.name, perishable: r.perishable, action: r.action, rec_qty: num(r.rec_qty),
      priority: num(r.priority), on_hand: num(r.on_hand), open_po: num(r.open_po), cover_weeks: num(r.cover_weeks),
      trend_pct: num(r.trend_pct), flags: r.flags, reason: r.reason, reason_source: r.reason_source, data_notes: r.data_notes,
      decision: r.decision ?? null, final_qty: num(r.final_qty), change_reason: r.change_reason ?? null,
      distributor_id: r.distributor_id ?? null, distributor_name: r.distributor_name ?? null,
      po_status: r.po_status ?? null, po_number: r.po_number ?? null,
    }));
  }

  const decisions: Decision[] = decisionRows.map((d) => ({
    decided_at: iso(d.decided_at), run_id: d.run_id, sku: d.sku, action: d.action, rec_qty: num(d.rec_qty), flags: d.flags,
    priority: num(d.priority), decision: d.decision, final_qty: num(d.final_qty), reason: d.reason, reviewer: d.reviewer,
    hours_to_decide: num(d.hours_to_decide), name: d.name ?? null,
    po_status: d.po_status, po_number: d.po_number, po_id: d.po_id, po_vendor: d.po_vendor, po_error: d.po_error,
    po_created_at: d.po_created_at ? iso(d.po_created_at) : null,
  }));
  const ruleReviews: RuleReview[] = reviewRows.map((r) => ({
    opened_at: iso(r.opened_at), rule: r.rule, changed: num(r.changed), total: num(r.total), rate: r.rate,
    proposal: r.proposal, status: r.status,
  }));

  return { demo: false, runs, latestRun, recs, decisions, ruleReviews };
}
