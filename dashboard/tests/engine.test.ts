import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ACTIONS, evaluateSku, runEngine, type EngineInput, type EngineSku } from "../lib/engine.ts";
import { defaultRules, RULE_DEFS, mergeRules, parseRuleInput, checkRules } from "../lib/rules.ts";
import { parseDataset } from "../lib/importers.ts";

const csv = (name: string) => readFileSync(fileURLToPath(new URL(`../../${name}`, import.meta.url)), "utf8");

const skus = parseDataset("sku_master", csv("sku_master.csv")).rows as EngineSku[];
const calendar = parseDataset("calendar", csv("calendar.csv")).rows.map((c) => ({ year_month: c.year_month, is_festival: c.is_festival }));
const sales = parseDataset("weekly_sales", csv("weekly_sales.csv")).rows.map((r) => ({ sku: r.sku_id, week: r.week, units: r.units }));
const inventory: Record<string, number> = {};
for (const r of parseDataset("current_inventory", csv("current_inventory.csv")).rows) inventory[r.sku_id] = (inventory[r.sku_id] ?? 0) + r.units_on_hand;

function run(overrides: Partial<EngineInput> = {}) {
  return runEngine({ sales, skus, inventory, openPos: {}, calendar, rules: defaultRules(), asOf: "2026-10-19", today: "2026-10-22", ...overrides });
}
const byId = (res: ReturnType<typeof run>) => Object.fromEntries(res.recs.map((r) => [r.sku, r]));

test("your sample files parse cleanly: 15 SKUs, 240 sales rows, no errors", () => {
  for (const [kind, file] of [["sku_master", "sku_master.csv"], ["weekly_sales", "weekly_sales.csv"], ["current_inventory", "current_inventory.csv"], ["calendar", "calendar.csv"], ["distributor_master", "distributor_master.csv"]] as const) {
    const r = parseDataset(kind, csv(file));
    assert.equal(r.errorCount, 0, `${file}: ${r.errors.join("; ")}`);
  }
  assert.equal(skus.length, 15);
  assert.equal(sales.length, 240);
});

test("defaults match the brief (Raghav's five rules)", () => {
  const r = defaultRules();
  assert.equal(r.HIGH_DEMAND_PCT, 0.2);
  assert.equal(r.HIGH_DEMAND_QTY_MULT, 1.5);
  assert.equal(r.STOCKOUT_WEEKS, 6);
  assert.equal(r.OVERSTOCK_WEEKS, 14);
  assert.equal(r.FESTIVAL_UPLIFT, 0.25);
  assert.equal(r.PERISHABLE_MIN_WEEKS, 3);
  assert.equal(r.PERISHABLE_MAX_WEEKS, 4);
  assert.equal(r.ADOPTION_KILL_PCT, 0.6);
  assert.equal(new Set(RULE_DEFS.map((d) => d.key)).size, RULE_DEFS.length, "no duplicate rule keys");
  assert.deepEqual(checkRules(r), []);
});

test("October (festival) run on the sample data flags exactly these 7 SKUs", () => {
  const res = run();
  assert.equal(res.festival, true);
  const got = Object.fromEntries(res.recs.map((r) => [r.sku, `${r.action}:${r.qty}`]));
  assert.deepEqual(got, {
    SKU001: "REORDER:750", SKU003: "REORDER:300", SKU004: "REORDER:150", SKU011: "REORDER:500",
    SKU013: "REORDER:120", SKU006: "PAUSE:0", SKU007: "PAUSE:0",
  });
  assert.equal(res.healthy, 8);
});

test("a SKU that is both stockout-risk and high-demand gets ONE merged recommendation at 1.5x", () => {
  const rows = run().recs.filter((r) => r.sku === "SKU001");
  assert.equal(rows.length, 1);
  assert.deepEqual([...rows[0].flags].sort(), ["HIGH_DEMAND", "STOCKOUT_RISK"]);
  assert.equal(rows[0].qty, 500 * 1.5);
});

test("festival uplift applies to cover, not the trend: SKU002 is overstock in September but fine in October", () => {
  assert.equal(byId(run({ asOf: "2026-09-19" })).SKU002.action, ACTIONS.PAUSE);
  assert.equal(byId(run()).SKU002, undefined);
});

test("uplift does not manufacture high-demand flags", () => {
  assert.deepEqual(run().recs.filter((r) => r.flags.includes("HIGH_DEMAND")).map((r) => r.sku), ["SKU001"]);
});

test("perishable window replaces 6/14: SKU007 (5.1 wks) is overstock only because its max is 4", () => {
  const rec = byId(run({ asOf: "2026-09-19" })).SKU007;
  assert.equal(rec.perishable, true);
  assert.deepEqual(rec.flags, ["OVERSTOCK_RISK"]);
  assert.equal(rec.ceilingWeeks, 4);
});

const sku = (over: Partial<EngineSku> = {}): EngineSku => ({ sku_id: "X1", name: "Item", category: "Snack", perishability: "Low", std_reorder_qty: 100, distributor_id: "D", ...over });
const hist = (n: number, u = 100) => Array.from({ length: n }, (_, i) => ({ week: `2026-W${String(10 + i).padStart(2, "0")}`, units: u }));

test("perishable reorder qty is capped so cover never exceeds the perishable max", () => {
  const rec = evaluateSku(sku({ perishability: "High", std_reorder_qty: 500 }), hist(12), 250, 0, false, defaultRules(), [])!;
  assert.equal(rec.action, ACTIONS.REORDER);
  assert.equal(rec.qty, 150);
  assert.match(rec.notes.join(" "), /capped/);
});

test("new SKU with under 12 weeks of history goes to Raghav, not the rules", () => {
  const rec = evaluateSku(sku(), hist(5, 50), 10, 0, false, defaultRules(), [])!;
  assert.equal(rec.action, ACTIONS.MANUAL);
  assert.deepEqual(rec.flags, ["SHORT_HISTORY"]);
});

test("overstocked but accelerating is a conflict: MANUAL_REVIEW, never an automatic pause or reorder", () => {
  const h = [...hist(8), ...hist(4, 150)].map((x, i) => ({ ...x, week: `2026-W${String(10 + i).padStart(2, "0")}` }));
  const rec = evaluateSku(sku(), h, 2000, 0, false, defaultRules(), [])!;
  assert.deepEqual([...rec.flags].sort(), ["HIGH_DEMAND", "OVERSTOCK_RISK"]);
  assert.equal(rec.action, ACTIONS.MANUAL);
  assert.equal(rec.qty, null);
});

test("open POs count as stock, so already-placed orders stop triggering stockout flags", () => {
  assert.ok(byId(run()).SKU001.flags.includes("STOCKOUT_RISK"));
  const withPo = byId(run({ openPos: { SKU001: 1000 } })).SKU001;
  assert.ok(!withPo.flags.includes("STOCKOUT_RISK"));
  assert.ok(withPo.flags.includes("HIGH_DEMAND"));
});

test("priority score is 1-100 and the list is sorted most urgent first", () => {
  const recs = run().recs;
  recs.forEach((r) => assert.ok(r.priority >= 1 && r.priority <= 100));
  for (let i = 1; i < recs.length; i++) assert.ok(recs[i - 1].priority >= recs[i].priority);
});

test("stale stock data is surfaced as a note on every recommendation", () => {
  const res = run({ today: "2026-10-30" });
  assert.ok(res.recs.length > 0);
  res.recs.forEach((r) => assert.match(r.dq.join(" "), /STALE_DATA/));
});

test("every recommendation carries a deterministic fallback reason", () => {
  run().recs.forEach((r) => assert.ok(r.reason && r.reason.length > 10, r.sku));
});

test("changing a rule changes the result: a 3-week stockout floor flags fewer SKUs", () => {
  const loose = run({ rules: { ...defaultRules(), STOCKOUT_WEEKS: 3 } });
  assert.ok(loose.recs.length < run().recs.length);
});

test("rules: stored values override defaults, bad values are ignored, input is validated", () => {
  const r = mergeRules([{ key: "STOCKOUT_WEEKS", value: "8" }, { key: "SHADOW_MODE", value: "true" }, { key: "OVERSTOCK_WEEKS", value: "abc" }, { key: "NOPE", value: "1" }]);
  assert.equal(r.STOCKOUT_WEEKS, 8);
  assert.equal(r.SHADOW_MODE, true);
  assert.equal(r.OVERSTOCK_WEEKS, 14);
  const pct = RULE_DEFS.find((d) => d.key === "HIGH_DEMAND_PCT")!;
  assert.deepEqual(parseRuleInput(pct, "25"), { ok: true, value: 0.25 });
  assert.equal(parseRuleInput(pct, "abc").ok, false);
  assert.equal(parseRuleInput(pct, "-5").ok, false);
  const weeks = RULE_DEFS.find((d) => d.key === "MIN_HISTORY_WEEKS")!;
  assert.equal(parseRuleInput(weeks, "12.5").ok, false);
  assert.ok(checkRules({ ...defaultRules(), STOCKOUT_WEEKS: 20 }).length > 0);
});
