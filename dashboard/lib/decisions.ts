import { getSql } from "./db.ts";
import { evaluateRuleFeedback } from "./feedback.ts";
import { generatePosForReady } from "./orders.ts";
import { checkDecision } from "./po.ts";
import { loadRules } from "./planning.ts";

export type DecisionOutcome =
  | { ok: true; decision: "Approve" | "Override" | "Reject"; poNumber: string | null; poFailed: boolean; message: string }
  | { ok: false; error: string };

/**
 * Raghav presses Approve or Reject on one recommendation. First decision wins; it cannot be changed afterwards.
 * Approve orders the quantity in the box (pre-filled with the recommendation) and creates that line's PO straight away.
 * Reject needs a reason and creates nothing.
 */
export async function recordDecision(i: { run_id: string; sku: string; button: string; qty: string; reason: string; reviewer: string }): Promise<DecisionOutcome> {
  const sql = getSql();
  const [rec] = await sql`
    select r.action, r.rec_qty, r.flags, r.priority, u.run_at, u.mode
    from recommendations r join runs u on u.run_id = r.run_id
    where r.run_id = ${i.run_id} and r.sku = ${i.sku}`;
  if (!rec) return { ok: false, error: "That recommendation no longer exists." };
  if (rec.mode !== "LIVE") return { ok: false, error: "This run was made in shadow mode: nothing to decide." };

  const check = checkDecision({
    action: String(rec.action), recQty: rec.rec_qty === null ? null : Number(rec.rec_qty), button: i.button, qty: i.qty, reason: i.reason,
  });
  if (!check.ok) return { ok: false, error: check.error };

  const runAt = new Date(rec.run_at).toISOString();
  const rows = await sql`
    insert into decisions (decided_at, run_id, sku, action, rec_qty, flags, priority, decision, final_qty, reason, reviewer, hours_to_decide, po_status)
    values (now(), ${i.run_id}, ${i.sku}, ${rec.action}, ${rec.rec_qty}, ${rec.flags}, ${rec.priority}, ${check.decision}, ${check.finalQty},
            ${check.reason}, ${i.reviewer}, round((extract(epoch from (now() - ${runAt}::timestamptz)) / 3600)::numeric, 1), ${check.poStatus})
    on conflict (run_id, sku) do nothing
    returning sku`;
  if (!rows.length) return { ok: false, error: "Someone already decided this one." };

  let poNumber: string | null = null;
  let poFailed = false;
  if (check.poStatus === "READY") {
    const gen = await generatePosForReady({ run_id: i.run_id, sku: i.sku });
    poNumber = gen.created[0]?.po_number ?? null;
    poFailed = !poNumber;
  }

  // Has this decision pushed a rule over the "changed too often" line? Then queue it for review.
  try {
    await evaluateRuleFeedback(await loadRules());
  } catch {
    /* the decision is already saved; the review queue catches up on the next one */
  }

  const message =
    check.decision === "Reject" ? `${i.sku} rejected.`
    : poNumber ? `${i.sku} approved: ${poNumber} created below.`
    : poFailed ? `${i.sku} approved, but the PO could not be created yet. Use "Create PO" on its card to retry.`
    : `${i.sku} approved: no order needed.`;
  return { ok: true, decision: check.decision, poNumber, poFailed, message };
}
