// Builds lib/demo-data.json: real engine output on the sample CSVs at five weekly cut-offs,
// plus ILLUSTRATIVE review decisions for the two LIVE runs. Shown only when DATABASE_URL is not set.
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const root = new URL("../../", import.meta.url);
const { runEngine } = require(new URL("apps-script/Engine.js", root).pathname.replace(/^\/([A-Za-z]:)/, "$1").replace(/%20/g, " "));
const { defaultRulesObject_ } = require(new URL("apps-script/Config.js", root).pathname.replace(/^\/([A-Za-z]:)/, "$1").replace(/%20/g, " "));

function csv(name) {
  const lines = readFileSync(new URL(name, root), "utf8").replace(/^﻿/, "").trim().split(/\r?\n/);
  const head = lines[0].split(",");
  return lines.slice(1).map((l) => Object.fromEntries(l.split(",").map((v, i) => [head[i], v.trim()])));
}

const skus = csv("sku_master.csv");
const calendar = csv("calendar.csv");
const sales = csv("weekly_sales.csv").map((r) => ({ sku: r.SKU_ID, week: r.Week, units: Number(r.Units_Sold) }));
const inventory = Object.fromEntries(csv("current_inventory.csv").map((r) => [r.SKU_ID, Number(r.Units_On_Hand)]));
const rules = defaultRulesObject_();
const dist = Object.fromEntries(csv("distributor_master.csv").map((r) => [r.Distributor_ID, r.Distributor_Name]));

const cuts = [
  ["2026-W38", "2026-09-21", "SHADOW"],
  ["2026-W39", "2026-09-28", "SHADOW"],
  ["2026-W40", "2026-10-05", "SHADOW"],
  ["2026-W41", "2026-10-12", "LIVE"],
  ["2026-W42", "2026-10-19", "LIVE"],
];

const addDays = (d, n) => new Date(new Date(d + "T08:00:00+05:30").getTime() + n * 86400000);
const runs = [];
const recsByRun = {};
for (const [wk, asOf, mode] of cuts) {
  const res = runEngine({ sales: sales.filter((s) => s.week <= wk), skus, inventory, openPos: {}, calendar, rules, asOf, today: asOf });
  const run_id = `DEMO-${wk}`;
  const count = (a) => res.recs.filter((r) => r.action === a).length;
  const tokens = 2400 + res.recs.length * 310;
  runs.push({
    run_id, run_at: addDays(asOf, 3).toISOString(), as_of: asOf, mode, status: "OK", skus: res.skuCount, completeness: 100,
    flagged: res.recs.length, healthy: res.healthy, n_reorder: count("REORDER"), n_pause: count("PAUSE"), n_manual: count("MANUAL_REVIEW"),
    festival: res.festival, gemini_reasons: `0/${res.recs.length} (demo uses template text)`, gemini_tokens: tokens,
    summary: `${res.recs.length} of ${res.skuCount} SKUs flagged${res.festival ? " (festival month, +25% applied)" : ""}: ${count("REORDER")} reorder, ${count("PAUSE")} pause.`,
    notes: "",
  });
  recsByRun[run_id] = res.recs.map((r) => ({
    run_id, sku: r.sku, name: r.name, perishable: r.perishable, action: r.action, rec_qty: r.qty, priority: r.priority,
    on_hand: r.onHand, open_po: r.openPo, cover_weeks: r.coverWeeks, trend_pct: r.trendPct, flags: r.flags.join(" + "),
    reason: r.reason, reason_source: "template", data_notes: r.dq.join("; "),
    distributor_id: r.distributor, distributor_name: dist[r.distributor] ?? null, po_status: null, po_number: null, decision: null, final_qty: null, change_reason: null,
  }));
}

const decisions = [];

const latest = runs[runs.length - 1];
const out = {
  demo: true,
  runs: runs.slice().reverse(),
  latestRun: latest,
  recs: recsByRun[latest.run_id],
  decisions: decisions.slice().reverse(),
  pos: [],
  impact: {
    entries: [
      ["2026-08-31", 1.55, 0.95, 0.35], ["2026-09-07", 1.5, 0.9, 0.3], ["2026-09-14", 1.4, 0.85, 0.3], ["2026-09-21", 1.3, 0.8, 0.25],
      ["2026-09-28", 1.25, 0.7, 0.25], ["2026-10-05", 1.1, 0.7, 0.2], ["2026-10-12", 1.0, 0.65, 0.2], ["2026-10-19", 0.95, 0.6, 0.15],
    ].map(([week_start, so, ov, pe]) => ({
      week_start, stockout_loss: Math.round(so * 100000), overstock_writeoff: Math.round(ov * 100000), perishable_part: Math.round(pe * 100000),
      note: week_start === "2026-10-12" ? "Illustrative demo entry" : null, entered_by: "demo",
    })),
    settings: { go_live: "2026-08-31", baseline_low: 2800000, baseline_high: 3400000, baseline_perishable_quarter: 390000, horizon_days: 90, target_pct: 0.3, kill_pct: 0.1 },
  },
  ruleReviews: [],
};
writeFileSync(new URL("../lib/demo-data.json", import.meta.url), JSON.stringify(out, null, 1));
console.log(`demo-data.json: ${runs.length} runs, ${out.recs.length} recs in latest run, no decisions`);
