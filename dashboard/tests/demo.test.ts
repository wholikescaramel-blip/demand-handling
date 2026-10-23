import test from "node:test";
import assert from "node:assert/strict";
import { applyDemo, demoPoNumber, type DemoDecision } from "../lib/demo-apply.ts";
import type { Rec, Snapshot } from "../lib/types.ts";

const rec = (sku: string, action: string, qty: number | null, vendor = "DIST001"): Rec => ({
  run_id: "R1", sku, name: `Item ${sku}`, perishable: false, action, rec_qty: qty, priority: 50, on_hand: 100, open_po: 0, cover_weeks: 3,
  trend_pct: 1, flags: "STOCKOUT_RISK", reason: "r", reason_source: "template", data_notes: "", distributor_id: vendor, distributor_name: `Vendor ${vendor}`,
  decision: null, final_qty: null, change_reason: null,
});

const base = {
  demo: true, runs: [], latestRun: null, decisions: [], ruleReviews: [], pos: [],
  recs: [rec("A", "REORDER", 100), rec("B", "REORDER", 200, "DIST002"), rec("C", "PAUSE", 0), rec("D", "MANUAL_REVIEW", null)],
  impact: { entries: [], settings: {} },
} as unknown as Snapshot;

const d = (sku: string, decision: DemoDecision["decision"], final_qty: number | null, reason: string | null = null): DemoDecision => ({
  run_id: "R1", sku, decision, final_qty, reason, at: "2026-10-23T09:00:00.000Z",
});

test("with no practice clicks, nothing is decided and nothing is created", () => {
  const s = applyDemo(base, []);
  assert.equal(s.recs.filter((r) => r.decision).length, 0);
  assert.equal(s.pos.length, 0);
  assert.equal(s.decisions.length, 0);
});

test("Approve creates one numbered PO for that line", () => {
  const s = applyDemo(base, [d("A", "Approve", 100)]);
  const a = s.recs.find((r) => r.sku === "A")!;
  assert.equal(a.decision, "Approve");
  assert.equal(a.po_number, demoPoNumber(1));
  assert.equal(s.pos.length, 1);
  assert.deepEqual(s.pos[0].lines.map((l) => [l.sku, l.qty]), [["A", 100]]);
  assert.equal(s.pos[0].vendor_name, "Vendor DIST001");
});

test("Reject, a skipped pause and a zero quantity create no PO", () => {
  const s = applyDemo(base, [d("A", "Reject", null, "no"), d("C", "Approve", 0), d("B", "Override", 0, "enough")]);
  assert.equal(s.pos.length, 0);
  assert.ok(s.recs.every((r) => !r.po_number));
  assert.equal(s.decisions.length, 3);
});

test("PO numbers follow the order of approval, and only undecided rows stay untouched", () => {
  const s = applyDemo(base, [d("B", "Approve", 200), d("A", "Override", 150, "scheme")]);
  assert.equal(s.recs.find((r) => r.sku === "B")!.po_number, demoPoNumber(1));
  assert.equal(s.recs.find((r) => r.sku === "A")!.po_number, demoPoNumber(2));
  assert.equal(s.recs.find((r) => r.sku === "D")!.decision, null);
  assert.equal(s.pos.length, 2);
});

test("a click on a SKU that is not in the run is ignored", () => {
  const s = applyDemo(base, [d("ZZZ", "Approve", 10)]);
  assert.equal(s.pos.length, 0);
  assert.equal(s.decisions.length, 0);
});
