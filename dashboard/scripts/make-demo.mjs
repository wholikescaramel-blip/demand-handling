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

// Illustrative decisions (clearly labelled as demo in the UI).
const decisions = [];
const poFor = {};
let poSeq = 0;
const plan = {
  "DEMO-2026-W41": { at: "2026-10-16T10:30:00+05:30", mix: ["Approve", "Approve", "Override", "Approve", "Reject", "Approve"] },
  "DEMO-2026-W42": { at: "2026-10-23T09:15:00+05:30", limit: 4, mix: ["Approve", "Override", "Approve", "Approve", "Override", "Reject", "Approve"] },
};
const why = {
  Override: "Distributor scheme running this week, order a bit more",
  Reject: "Open PO already placed outside the system",
};
for (const [run_id, p] of Object.entries(plan)) {
  recsByRun[run_id].slice(0, p.limit ?? 99).forEach((r, i) => {
    const decision = p.mix[i % p.mix.length];
    const final_qty = decision === "Reject" ? null : decision === "Override" ? Math.round((r.rec_qty ?? 0) * 1.2) : r.rec_qty;
    const hours = [3.5, 6, 11, 19, 27, 8, 2][i % 7];
    const orders = decision !== "Reject" && final_qty > 0;
    const created = orders && run_id === "DEMO-2026-W41";
    const po_status = created ? "CREATED" : orders ? "READY" : "NONE";
    const po_number = created ? (poFor[r.distributor_id] ??= "DP-2026-" + String(++poSeq).padStart(4, "0")) : null;
    decisions.push({
      decided_at: p.at, run_id, sku: r.sku, name: r.name, action: r.action, rec_qty: r.rec_qty, flags: r.flags, priority: r.priority,
      decision, final_qty, reason: why[decision] ?? null, reviewer: "raghav@freshroots.example", hours_to_decide: hours,
      po_status, po_number, po_id: created ? "demo-" + po_number : null, po_vendor: created ? r.distributor_name : null, po_error: null,
      po_created_at: created ? "2026-10-16T11:40:00+05:30" : null,
    });
    r.decision = decision; r.final_qty = final_qty; r.change_reason = why[decision] ?? null; r.po_status = po_status; r.po_number = po_number;
  });
}

const pos = Object.values(
  decisions.filter((d) => d.po_status === "CREATED").reduce((acc, d) => {
    const key = d.po_number;
    const rec = Object.values(recsByRun).flat().find((r) => r.run_id === d.run_id && r.sku === d.sku);
    acc[key] ??= {
      po_number: key, created_at: "2026-10-16T11:40:00+05:30", vendor_key: rec.distributor_id, vendor_name: rec.distributor_name,
      run_ids: d.run_id, created_by: "raghav@freshroots.example", total_qty: 0, lines: [],
      delivered_at: "2026-10-16T12:05:00+05:30", received_at: null,
    };
    acc[key].lines.push({ run_id: d.run_id, sku: d.sku, name: d.name, qty: d.final_qty });
    acc[key].total_qty += d.final_qty;
    return acc;
  }, {}),
).reverse();

const latest = runs[runs.length - 1];
const out = {
  demo: true,
  runs: runs.slice().reverse(),
  latestRun: latest,
  recs: recsByRun[latest.run_id],
  decisions: decisions.slice().reverse(),
  pos,
  ruleReviews: [
    { opened_at: "2026-10-23T09:20:00+05:30", rule: "STOCKOUT_RISK", changed: 5, total: 10, rate: "50%", proposal: "Illustrative: overrides cluster on fast-moving SKUs in festival weeks, so test a larger reorder multiple there before touching the 6-week floor.", status: "OPEN" },
  ],
};
writeFileSync(new URL("../lib/demo-data.json", import.meta.url), JSON.stringify(out, null, 1));
console.log(`demo-data.json: ${runs.length} runs, ${decisions.length} illustrative decisions, ${out.recs.length} recs in latest run`);
