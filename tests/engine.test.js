const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { runEngine, evaluateSku, ACTIONS } = require('../apps-script/Engine.js');
const { defaultRulesObject_, DEFAULT_RULES } = require('../apps-script/Config.js');
const { usesOnlyAllowedNumbers } = require('../apps-script/Gemini.js');

const root = path.join(__dirname, '..');
function csv(name) {
  const lines = fs.readFileSync(path.join(root, name), 'utf8').replace(/^﻿/, '').trim().split(/\r?\n/);
  const head = lines[0].split(',');
  return lines.slice(1).map((l) => Object.fromEntries(l.split(',').map((v, i) => [head[i], v.trim()])));
}

const skus = csv('sku_master.csv');
const calendar = csv('calendar.csv');
const sales = csv('weekly_sales.csv').map((r) => ({ sku: r.SKU_ID, week: r.Week, units: Number(r.Units_Sold) }));
const inventory = Object.fromEntries(csv('current_inventory.csv').map((r) => [r.SKU_ID, Number(r.Units_On_Hand)]));

function run(overrides = {}) {
  return runEngine({
    sales, skus, inventory, openPos: {}, calendar, rules: defaultRulesObject_(),
    asOf: '2026-10-19', today: '2026-10-22', ...overrides,
  });
}
const byId = (res) => Object.fromEntries(res.recs.map((r) => [r.sku, r]));

test('defaults match the brief (Raghav\'s five rules)', () => {
  const r = defaultRulesObject_();
  assert.equal(r.HIGH_DEMAND_PCT, 0.2);
  assert.equal(r.HIGH_DEMAND_QTY_MULT, 1.5);
  assert.equal(r.STOCKOUT_WEEKS, 6);
  assert.equal(r.OVERSTOCK_WEEKS, 14);
  assert.equal(r.FESTIVAL_UPLIFT, 0.25);
  assert.equal(r.PERISHABLE_MIN_WEEKS, 3);
  assert.equal(r.PERISHABLE_MAX_WEEKS, 4);
  assert.equal(DEFAULT_RULES.length, Object.keys(r).length, 'no duplicate rule keys');
});

test('sample data: the sample file loads as 15 SKUs x 16 weeks', () => {
  assert.equal(skus.length, 15);
  assert.equal(sales.length, 240);
});

test('October (festival) run on the sample data flags exactly these 7 SKUs', () => {
  const res = run();
  assert.equal(res.festival, true);
  const got = Object.fromEntries(res.recs.map((r) => [r.sku, `${r.action}:${r.qty}`]));
  assert.deepEqual(got, {
    SKU001: 'REORDER:750', SKU003: 'REORDER:300', SKU004: 'REORDER:150', SKU011: 'REORDER:500',
    SKU013: 'REORDER:120', SKU006: 'PAUSE:0', SKU007: 'PAUSE:0',
  });
  assert.equal(res.healthy, 8);
});

test('a SKU that is both stockout-risk and high-demand gets ONE merged recommendation at 1.5x', () => {
  const res = run();
  const rows = res.recs.filter((r) => r.sku === 'SKU001');
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].flags.sort(), ['HIGH_DEMAND', 'STOCKOUT_RISK']);
  assert.equal(rows[0].qty, 500 * 1.5);
});

test('festival uplift applies to cover, not the trend: SKU002 is overstock in September but fine in October', () => {
  assert.equal(byId(run({ asOf: '2026-09-19' })).SKU002.action, ACTIONS.PAUSE);
  assert.equal(byId(run()).SKU002, undefined);
});

test('uplift does not manufacture high-demand flags', () => {
  const highDemand = run().recs.filter((r) => r.flags.includes('HIGH_DEMAND')).map((r) => r.sku);
  assert.deepEqual(highDemand, ['SKU001']);
});

test('perishable window replaces 6/14: SKU007 (5.1 wks) is overstock only because its max is 4', () => {
  const rec = byId(run({ asOf: '2026-09-19' })).SKU007;
  assert.equal(rec.perishable, true);
  assert.deepEqual(rec.flags, ['OVERSTOCK_RISK']);
  assert.equal(rec.ceilingWeeks, 4);
});

test('perishable reorder qty is capped so cover never exceeds the perishable max', () => {
  const sku = { SKU_ID: 'P1', SKU_Name: 'Perishable', Category: 'Dairy', Perishability: 'High', Standard_Reorder_Qty: '500', Distributor_ID: 'D' };
  const hist = Array.from({ length: 12 }, (_, i) => ({ week: `2026-W${20 + i}`, units: 100 }));
  const rec = evaluateSku(sku, hist, 250, 0, false, defaultRulesObject_(), []);
  assert.equal(rec.action, ACTIONS.REORDER);
  assert.equal(rec.qty, 150); // 4 weeks * 100 - 250 on hand, not the standard 500
  assert.match(rec.notes.join(' '), /capped/);
});

test('new SKU with under 12 weeks of history goes to Raghav, not the rules', () => {
  const sku = { SKU_ID: 'N1', SKU_Name: 'New launch', Category: 'Snack', Perishability: 'Low', Standard_Reorder_Qty: '100', Distributor_ID: 'D' };
  const hist = Array.from({ length: 5 }, (_, i) => ({ week: `2026-W${38 + i}`, units: 50 }));
  const rec = evaluateSku(sku, hist, 10, 0, false, defaultRulesObject_(), []);
  assert.equal(rec.action, ACTIONS.MANUAL);
  assert.deepEqual(rec.flags, ['SHORT_HISTORY']);
});

test('overstocked but accelerating is a conflict: MANUAL_REVIEW, never an automatic pause or reorder', () => {
  const sku = { SKU_ID: 'C1', SKU_Name: 'Conflict', Category: 'Snack', Perishability: 'Low', Standard_Reorder_Qty: '100', Distributor_ID: 'D' };
  const units = [...Array(8).fill(100), ...Array(4).fill(150)];
  const hist = units.map((u, i) => ({ week: `2026-W${20 + i}`, units: u }));
  const rec = evaluateSku(sku, hist, 2000, 0, false, defaultRulesObject_(), []);
  assert.deepEqual(rec.flags.sort(), ['HIGH_DEMAND', 'OVERSTOCK_RISK']);
  assert.equal(rec.action, ACTIONS.MANUAL);
  assert.equal(rec.qty, null);
});

test('open POs count as stock, so already-placed orders stop triggering stockout flags', () => {
  const without = byId(run()).SKU001;
  assert.ok(without.flags.includes('STOCKOUT_RISK'));
  const withPo = byId(run({ openPos: { SKU001: 1000 } })).SKU001;
  assert.ok(!withPo.flags.includes('STOCKOUT_RISK'));
  assert.ok(withPo.flags.includes('HIGH_DEMAND'));
});

test('priority score is 1-100 and the list is sorted most urgent first', () => {
  const recs = run().recs;
  recs.forEach((r) => assert.ok(r.priority >= 1 && r.priority <= 100));
  for (let i = 1; i < recs.length; i++) assert.ok(recs[i - 1].priority >= recs[i].priority);
});

test('stale inventory is surfaced as a data note on every recommendation', () => {
  const res = run({ today: '2026-10-30' });
  assert.ok(res.recs.length > 0);
  res.recs.forEach((r) => assert.match(r.dq.join(' '), /STALE_DATA/));
});

test('every recommendation carries a deterministic fallback reason', () => {
  run().recs.forEach((r) => assert.ok(r.reason && r.reason.length > 10, r.sku));
});

test('Gemini guard: reasons may only reuse numbers from the facts', () => {
  const facts = JSON.stringify({ weeksOfCover: 3.4, floorWeeks: 6, qty: 750 });
  assert.equal(usesOnlyAllowedNumbers('Only 3.4 weeks of stock against a 6-week floor.', facts), true);
  assert.equal(usesOnlyAllowedNumbers('Order 800 units now.', facts), false);
  assert.equal(usesOnlyAllowedNumbers('Stock is running low.', facts), true);
});
