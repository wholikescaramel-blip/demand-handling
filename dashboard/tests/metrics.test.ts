import test from "node:test";
import assert from "node:assert/strict";
import {
  decisionStats, weeklyChangeRate, perRuleStats, killChecks, isoWeek, runSeries, estimateCostInr,
} from "../lib/metrics.ts";
import type { Decision, Run } from "../lib/types.ts";

const d = (decision: string, at: string, flags = "STOCKOUT_RISK", hours: number | null = 5): Decision => ({
  decided_at: at, run_id: "R1", sku: "S" + Math.random(), action: "REORDER", rec_qty: 100, flags, priority: 50,
  decision, final_qty: 100, reason: null, reviewer: "raghav", hours_to_decide: hours,
});

test("isoWeek", () => {
  assert.equal(isoWeek("2026-10-22T09:00:00+05:30"), "2026-W43");
  assert.equal(isoWeek("2026-01-01T00:00:00Z"), "2026-W01");
});

test("decisionStats: rates exclude EXPIRED and handle empty", () => {
  const s = decisionStats([
    d("Approve", "2026-10-20T10:00:00Z"), d("Approve", "2026-10-20T10:00:00Z"),
    d("Override", "2026-10-20T10:00:00Z", "HIGH_DEMAND", 30), d("Reject", "2026-10-20T10:00:00Z"),
    d("EXPIRED", "2026-10-20T10:00:00Z", "STOCKOUT_RISK", null),
  ]);
  assert.equal(s.decided, 4);
  assert.equal(s.expired, 1);
  assert.equal(s.changedRate, 0.5);
  assert.equal(s.rejectRate, 0.25);
  assert.equal(s.slaRate, 0.75); // 3 of 4 within 24h
  const empty = decisionStats([]);
  assert.equal(empty.changedRate, null);
  assert.equal(empty.avgHours, null);
});

test("weeklyChangeRate groups by ISO week, oldest first", () => {
  const w = weeklyChangeRate([
    d("Approve", "2026-10-27T10:00:00Z"), d("Reject", "2026-10-13T10:00:00Z"), d("Approve", "2026-10-14T10:00:00Z"),
  ]);
  assert.deepEqual(w.map((x) => x.week), ["2026-W42", "2026-W44"]);
  assert.equal(w[0].rate, 0.5);
});

test("perRuleStats counts a combined flag for both rules", () => {
  const r = perRuleStats([d("Override", "2026-10-20T10:00:00Z", "STOCKOUT_RISK + HIGH_DEMAND"), d("Approve", "2026-10-20T10:00:00Z", "STOCKOUT_RISK")]);
  const so = r.find((x) => x.rule === "STOCKOUT_RISK")!;
  const hd = r.find((x) => x.rule === "HIGH_DEMAND")!;
  assert.deepEqual([so.total, so.changed, hd.total, hd.changed], [2, 1, 1, 1]);
});

const run = (completeness: number | null): Run => ({
  run_id: "R1", run_at: "2026-10-22T08:00:00Z", as_of: "2026-10-19", mode: "LIVE", status: "OK", skus: 15,
  completeness, flagged: 7, healthy: 8, n_reorder: 5, n_pause: 2, n_manual: 0, festival: true,
  gemini_reasons: "7/7", gemini_tokens: 1000, summary: "", notes: "",
});

test("killChecks: completeness gate and adoption need 4 straight weeks", () => {
  const stats = decisionStats([d("Reject", "2026-10-20T10:00:00Z")]);
  const low = killChecks(run(90), stats, []);
  assert.equal(low[0].status, "breach");
  assert.equal(killChecks(run(100), stats, [])[0].status, "ok");

  const weeks = ["2026-W40", "2026-W41", "2026-W42", "2026-W43"].map((week) => ({ week, rate: 0.5, n: 10 }));
  assert.equal(killChecks(run(100), stats, weeks)[1].status, "breach");
  assert.equal(killChecks(run(100), stats, weeks.slice(2))[1].status, "warn");
  assert.equal(killChecks(run(100), stats, [])[1].status, "na");
});

test("runSeries drops failed runs and orders oldest first", () => {
  const a = { ...run(100), run_id: "A", as_of: "2026-10-12" };
  const b = { ...run(100), run_id: "B", as_of: "2026-10-19" };
  const bad = { ...run(100), run_id: "C", status: "ABORTED" };
  assert.deepEqual(runSeries([b, bad, a]).map((p) => p.label), ["2026-10-12", "2026-10-19"]);
});

test("estimateCostInr is null until a price is set", () => {
  assert.equal(estimateCostInr(2_000_000, null), null);
  assert.equal(estimateCostInr(2_000_000, 10), 20);
});
