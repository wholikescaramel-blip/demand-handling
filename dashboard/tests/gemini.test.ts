import test from "node:test";
import assert from "node:assert/strict";
import { explainRecs, usesOnlyAllowedNumbers } from "../lib/gemini.ts";
import { defaultRules } from "../lib/rules.ts";
import type { Rec } from "../lib/engine.ts";

const rec = (sku: string): Rec => ({
  sku, name: "Item", category: null, perishable: false, distributor: "D", stdQty: 100, unit: null, hsn: null, unitCost: null, taxPct: null,
  onHand: 50, openPo: 0, festival: false, dq: [], action: "REORDER", qty: 100, flags: ["STOCKOUT_RISK"], priority: 40, avg12: 20, avg4: 20,
  trendPct: 0, coverWeeks: 2.5, floorWeeks: 6, ceilingWeeks: 14, notes: [], reason: "Template reason text here.",
});

const reply = (items: unknown) =>
  (async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(items) }] } }] }), { status: 200 })) as unknown as typeof fetch;

test("number guard: only numbers from the facts may appear", () => {
  const facts = JSON.stringify({ weeksOfCover: 3.4, floorWeeks: 6, qty: 750 });
  assert.equal(usesOnlyAllowedNumbers("Only 3.4 weeks of stock against a 6-week floor.", facts), true);
  assert.equal(usesOnlyAllowedNumbers("Order 800 units now.", facts), false);
  assert.equal(usesOnlyAllowedNumbers("Stock is running low.", facts), true);
});

test("without a Gemini key the template reasons are used and nothing is called", async () => {
  delete process.env.GEMINI_API_KEY;
  let called = false;
  const out = await explainRecs([rec("A")], defaultRules(), (async () => { called = true; return new Response("{}"); }) as unknown as typeof fetch);
  assert.equal(called, false);
  assert.equal(out.reasons.A, "Template reason text here.");
  assert.equal(out.source.A, "template");
  assert.match(out.error, /key not set/);
});

test("a valid Gemini reply is used; a reply with an invented number is rejected", async () => {
  process.env.GEMINI_API_KEY = "test-key";
  try {
    const good = await explainRecs([rec("A"), rec("B")], defaultRules(), reply([{ sku: "A", reason: "Only 2.5 weeks of stock against a 6-week floor." }, { sku: "B", reason: "Order 999 units today." }]));
    assert.equal(good.source.A, "gemini");
    assert.equal(good.reasons.A, "Only 2.5 weeks of stock against a 6-week floor.");
    assert.equal(good.source.B, "template");
    assert.equal(good.reasons.B, "Template reason text here.");
  } finally {
    delete process.env.GEMINI_API_KEY;
  }
});

test("a failing Gemini call falls back to template reasons and reports why", async () => {
  process.env.GEMINI_API_KEY = "test-key";
  try {
    const out = await explainRecs([rec("A")], defaultRules(), (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch);
    assert.equal(out.source.A, "template");
    assert.match(out.error, /HTTP 500/);
  } finally {
    delete process.env.GEMINI_API_KEY;
  }
});
