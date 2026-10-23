import type { Decision, PurchaseOrder, Snapshot } from "./types.ts";

/**
 * Practice mode (no database): Raghav's clicks are kept in a browser cookie and laid over the sample run, so the whole
 * flow can be tried without anything being stored on a server. Nothing here decides anything by itself.
 */
export type DemoDecision = {
  run_id: string;
  sku: string;
  decision: "Approve" | "Override" | "Reject";
  final_qty: number | null;
  reason: string | null;
  at: string; // ISO
};

export const DEMO_REVIEWER = "you (practice)";

export function demoPoNumber(n: number): string {
  return `DP-DEMO-${String(n).padStart(4, "0")}`;
}

export function applyDemo(base: Snapshot, list: DemoDecision[]): Snapshot {
  const byKey = new Map(list.map((d) => [`${d.run_id}|${d.sku}`, d]));
  const recByKey = new Map(base.recs.map((r) => [`${r.run_id}|${r.sku}`, r]));

  // one PO per approved line with a quantity, numbered in the order Raghav approved them
  const ordering = list.filter((d) => d.decision !== "Reject" && (d.final_qty ?? 0) > 0 && recByKey.has(`${d.run_id}|${d.sku}`));
  const poOf = new Map(ordering.map((d, i) => [`${d.run_id}|${d.sku}`, demoPoNumber(i + 1)]));

  const recs = base.recs.map((r) => {
    const d = byKey.get(`${r.run_id}|${r.sku}`);
    if (!d) return r;
    const po = poOf.get(`${r.run_id}|${r.sku}`) ?? null;
    return { ...r, decision: d.decision, final_qty: d.final_qty, change_reason: d.reason, po_status: po ? "CREATED" : "NONE", po_number: po };
  });

  const pos: PurchaseOrder[] = ordering.map((d) => {
    const r = recByKey.get(`${d.run_id}|${d.sku}`)!;
    return {
      po_number: poOf.get(`${d.run_id}|${d.sku}`)!,
      created_at: d.at,
      vendor_key: r.distributor_id ?? "UNKNOWN",
      vendor_name: r.distributor_name ?? null,
      vendor: { key: r.distributor_id ?? "UNKNOWN", name: r.distributor_name ?? null, address: null, gstin: null, contact: null, email: null },
      run_ids: d.run_id,
      created_by: DEMO_REVIEWER,
      total_qty: d.final_qty ?? 0,
      total_amount: null,
      lines: [{ run_id: d.run_id, sku: d.sku, name: r.name, qty: d.final_qty ?? 0 }],
      sent_at: null,
      sent_to: null,
      received_at: null,
    };
  });

  const decisions: Decision[] = list
    .filter((d) => recByKey.has(`${d.run_id}|${d.sku}`))
    .map((d) => {
      const r = recByKey.get(`${d.run_id}|${d.sku}`)!;
      const po = poOf.get(`${d.run_id}|${d.sku}`) ?? null;
      return {
        decided_at: d.at, run_id: d.run_id, sku: d.sku, action: r.action, rec_qty: r.rec_qty, flags: r.flags, priority: r.priority,
        decision: d.decision, final_qty: d.final_qty, reason: d.reason, reviewer: DEMO_REVIEWER, hours_to_decide: null, name: r.name,
        po_status: po ? "CREATED" : "NONE", po_number: po, po_created_at: po ? d.at : null,
      };
    })
    .reverse();

  return { ...base, recs, decisions, pos: pos.slice().reverse() };
}
