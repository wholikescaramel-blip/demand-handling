import test from "node:test";
import assert from "node:assert/strict";
import { evaluateImpact, IMPACT_DEFAULTS, mondayOf, parseSettings, weeklyBaseline, type LossEntry } from "../lib/impact.ts";

const S = { ...IMPACT_DEFAULTS, go_live: "2026-09-01" };
// baseline: (28L + 34L) / 2 / 13 = Rs 238,461.54 a week
const entry = (week_start: string, stockout: number, overstock: number, per = 0): LossEntry => ({
  week_start, stockout_loss: stockout, overstock_writeoff: overstock, perishable_part: per, note: null, entered_by: "raghav",
});
const weeks = (n: number, weekly: number) =>
  Array.from({ length: n }, (_, i) => entry(new Date(Date.UTC(2026, 8, 7 + i * 7)).toISOString().slice(0, 10), weekly * 0.6, weekly * 0.4));

test("weekly baseline is the middle of the quarterly range over 13 weeks", () => {
  assert.equal(Math.round(weeklyBaseline(S)), 238462);
});

test("no go-live date, or a future one, means tracking has not started", () => {
  assert.equal(evaluateImpact([], { ...S, go_live: null }, "2026-10-23").phase, "not_started");
  const f = evaluateImpact([], { ...S, go_live: "2026-12-01" }, "2026-10-23");
  assert.equal(f.phase, "not_started");
  assert.match(f.verdict, /2026-12-01/);
});

test("fewer than 4 weekly entries gives no reading yet", () => {
  const r = evaluateImpact(weeks(3, 150000), S, "2026-10-01");
  assert.equal(r.status, "na");
  assert.match(r.verdict, /1 more week/);
  assert.equal(r.series.length, 3);
});

test("a 35% reduction is on target while tracking, and the day counter is right", () => {
  const r = evaluateImpact(weeks(8, 155000), S, "2026-10-23");
  assert.equal(r.status, "on_target");
  assert.equal(r.phase, "tracking");
  assert.equal(r.day, 53);
  assert.equal(r.daysLeft, 37);
  assert.ok(r.reductionPct! > 0.3);
  assert.match(r.verdict, /On track/);
  assert.ok(r.savedTotal! > 0);
});

test("between the kill line and the target is 'improving'", () => {
  const r = evaluateImpact(weeks(8, 200000), S, "2026-10-23"); // about 16% below baseline
  assert.equal(r.status, "improving");
});

test("day 90 with less than 10% improvement recommends going back to manual", () => {
  const r = evaluateImpact(weeks(8, 235000), S, "2026-11-30"); // day 91
  assert.equal(r.phase, "decision");
  assert.equal(r.status, "revert");
  assert.match(r.verdict, /shift back to manual/);
});

test("day 90 on target recommends keeping the system", () => {
  const r = evaluateImpact(weeks(8, 140000), S, "2026-11-30");
  assert.match(r.verdict, /keep the system/);
});

test("worse than baseline reads as above baseline, not a negative percentage", () => {
  const r = evaluateImpact(weeks(5, 300000), S, "2026-10-15");
  assert.equal(r.status, "revert");
  assert.match(r.verdict, /above the pre-AI baseline/);
  assert.ok(r.savedTotal! < 0);
});

test("weeks entirely before go-live are ignored", () => {
  const entries = [entry("2026-08-10", 999999, 0), ...weeks(5, 150000)];
  const r = evaluateImpact(entries, S, "2026-10-15");
  assert.equal(r.weeks, 5);
});

test("cumulative savings add up week by week", () => {
  const r = evaluateImpact(weeks(4, 138461.54), S, "2026-10-05"); // exactly Rs 100k under baseline each week
  assert.deepEqual(r.series.map((p) => Math.round(p.cumSaved / 1000)), [100, 200, 300, 400]);
});

test("rising perishable write-offs are flagged against their baseline", () => {
  const entries = weeks(5, 150000).map((e) => ({ ...e, perishable_part: 60000 }));
  const r = evaluateImpact(entries, { ...S, baseline_perishable_quarter: 390000 }, "2026-10-15"); // 30k a week baseline
  assert.equal(r.perishableRising, true);
  assert.match(r.verdict, /guardrail/);
  assert.equal(evaluateImpact(entries, S, "2026-10-15").perishableRising, false);
});

test("mondayOf and parseSettings", () => {
  assert.equal(mondayOf("2026-10-23"), "2026-10-19"); // a Friday
  assert.equal(mondayOf("2026-10-19"), "2026-10-19");
  const s = parseSettings([{ key: "baseline_low", value: "3000000" }], "2026-10-16T08:00:00+05:30");
  assert.equal(s.baseline_low, 3000000);
  assert.equal(s.baseline_high, 3400000);
  assert.equal(s.go_live, "2026-10-16");
  assert.equal(parseSettings([{ key: "go_live", value: "2026-09-01" }], "2026-10-16T08:00:00Z").go_live, "2026-09-01");
});
