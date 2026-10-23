// Whole-flow tests against an in-memory Postgres with the real schema (PGlite): import, plan, decide, PO, feedback.
process.env.DP_TEST_PGLITE = "1";
delete process.env.GEMINI_API_KEY;

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const { getSql } = await import("../lib/db.ts");
const store = await import("../lib/store.ts");
const { runPlanning } = await import("../lib/planning.ts");
const { recordDecision } = await import("../lib/decisions.ts");
const { evaluateRuleFeedback } = await import("../lib/feedback.ts");
const { getSnapshot, getPo } = await import("../lib/data.ts");
const { parseDataset } = await import("../lib/importers.ts");

const csv = (name: string) => readFileSync(fileURLToPath(new URL(`../../${name}`, import.meta.url)), "utf8");
const sql = getSql();

test("importing your five CSVs fills Neon, in the right order, with no skipped rows", async () => {
  for (const [kind, file] of [["distributor_master", "distributor_master.csv"], ["sku_master", "sku_master.csv"], ["weekly_sales", "weekly_sales.csv"], ["current_inventory", "current_inventory.csv"], ["calendar", "calendar.csv"]] as const) {
    const r = await store.importDataset(kind, csv(file), "upsert", "tester", file);
    assert.equal(r.ok, true, `${file}: ${r.errors.join("; ")}`);
    assert.equal(r.skipped, 0, file);
  }
  const s = Object.fromEntries((await store.datasetSummaries()).map((d) => [d.kind, d.rows]));
  assert.deepEqual(s, { sku_master: 15, distributor_master: 4, weekly_sales: 240, current_inventory: 15, calendar: 24 });
});

test("importing again is safe: the same rows update, nothing doubles", async () => {
  const r = await store.importDataset("weekly_sales", csv("weekly_sales.csv"), "upsert", "tester", "weekly_sales.csv");
  assert.equal(r.imported, 240);
  assert.equal(Number((await sql`select count(*) as n from sales_weekly`)[0].n), 240);
});

test("sales for a SKU that does not exist are skipped and named, not imported", async () => {
  const r = await store.importDataset("weekly_sales", "SKU_ID,Week,Units_Sold\nGHOST1,2026-W42,5\nSKU001,2026-W43,200", "upsert", "tester", "x.csv");
  assert.equal(r.imported, 1);
  assert.equal(r.skipped, 1);
  assert.match(r.notes.join(" "), /GHOST1/);
  await sql`delete from sales_weekly where week = '2026-W43'`;
});

test("a file with the wrong columns changes nothing", async () => {
  const before = Number((await sql`select count(*) as n from skus`)[0].n);
  const r = await store.importDataset("sku_master", "SKU_ID,Name\nA,B", "upsert", "tester", "bad.csv");
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /Missing column/);
  assert.equal(Number((await sql`select count(*) as n from skus`)[0].n), before);
});

let runId = "";
test("a planning run on the sample data flags the same 7 SKUs as the rules engine, and sends them for review", async () => {
  const res = await runPlanning("tester");
  assert.equal(res.ok, true, res.message);
  assert.equal(res.mode, "LIVE");
  assert.equal(res.flagged, 7);
  runId = res.runId!;
  const snap = (await getSnapshot())!;
  assert.equal(snap.latestRun?.run_id, runId);
  assert.equal(snap.latestRun?.completeness, 100);
  assert.deepEqual(Object.fromEntries(snap.recs.map((r) => [r.sku, `${r.action}:${r.rec_qty}`])), {
    SKU001: "REORDER:750", SKU003: "REORDER:300", SKU004: "REORDER:150", SKU011: "REORDER:500", SKU013: "REORDER:120", SKU006: "PAUSE:0", SKU007: "PAUSE:0",
  });
  assert.ok(snap.recs.every((r) => !r.decision), "nothing is pre-decided");
  assert.ok(snap.recs.every((r) => r.distributor_name), "vendors are attached");
});

test("Approve creates that line's PO immediately, with the vendor details frozen in", async () => {
  const out = await recordDecision({ run_id: runId, sku: "SKU001", button: "Approve", qty: "750", reason: "", reviewer: "raghav" });
  assert.equal(out.ok, true);
  assert.ok(out.ok && out.poNumber && /^DP-\d{4}-0001$/.test(out.poNumber));
  const po = await getPo((out as { poNumber: string }).poNumber);
  assert.equal(po?.total_qty, 750);
  assert.equal(po?.vendor_name, "NutriFlow Distributors");
  assert.equal(po?.created_by, "raghav");
  assert.deepEqual(po?.lines.map((l) => [l.sku, l.qty]), [["SKU001", 750]]);
});

test("changing the quantity needs a reason and is stored as an override; a second decision is refused", async () => {
  const bad = await recordDecision({ run_id: runId, sku: "SKU003", button: "Approve", qty: "400", reason: "", reviewer: "raghav" });
  assert.equal(bad.ok, false);
  const ok = await recordDecision({ run_id: runId, sku: "SKU003", button: "Approve", qty: "400", reason: "Scheme running", reviewer: "raghav" });
  assert.ok(ok.ok && ok.decision === "Override" && ok.poNumber);
  const again = await recordDecision({ run_id: runId, sku: "SKU003", button: "Reject", qty: "", reason: "changed my mind", reviewer: "raghav" });
  assert.ok(!again.ok && /already decided/.test(again.error));
});

test("reject needs a reason, creates no PO; a pause approved at 0 creates none either", async () => {
  assert.equal((await recordDecision({ run_id: runId, sku: "SKU013", button: "Reject", qty: "", reason: "", reviewer: "raghav" })).ok, false);
  const rej = await recordDecision({ run_id: runId, sku: "SKU013", button: "Reject", qty: "", reason: "Already ordered by phone", reviewer: "raghav" });
  assert.ok(rej.ok && rej.decision === "Reject" && rej.poNumber === null);
  const pause = await recordDecision({ run_id: runId, sku: "SKU006", button: "Approve", qty: "0", reason: "", reviewer: "raghav" });
  assert.ok(pause.ok && pause.decision === "Approve" && pause.poNumber === null);
  assert.equal(Number((await sql`select count(*) as n from purchase_orders`)[0].n), 2);
});

test("a rule changed or rejected often enough is queued for review (once)", async () => {
  await sql`insert into rules (key, value) values ('OVERRIDE_ALERT_COUNT', '2') on conflict (key) do update set value = '2'`;
  const { loadRules } = await import("../lib/planning.ts");
  const opened = await evaluateRuleFeedback(await loadRules());
  assert.ok(opened.includes("STOCKOUT_RISK"), `opened: ${opened.join(",")}`);
  assert.deepEqual(await evaluateRuleFeedback(await loadRules()), [], "no duplicate review");
  const snap = (await getSnapshot())!;
  assert.equal(snap.ruleReviews.filter((r) => r.rule === "STOCKOUT_RISK" && r.status === "OPEN").length, 1);
});

test("the next run counts POs still on order as stock, and expires what was left undecided", async () => {
  await new Promise((r) => setTimeout(r, 1100)); // run ids are per second
  const res = await runPlanning("tester");
  assert.equal(res.ok, true);
  const snap = (await getSnapshot())!;
  const sku1 = snap.recs.find((r) => r.sku === "SKU001")!;
  assert.ok(!(sku1.flags ?? "").includes("STOCKOUT_RISK"), "750 on order lifts SKU001 out of stockout");
  assert.equal(sku1.open_po, 750);
  const expired = await sql`select count(*) as n from decisions where run_id = ${runId} and decision = 'EXPIRED'`;
  assert.equal(Number(expired[0].n), 3, "SKU004, SKU011 and SKU007 were never decided, so they are closed as expired");
});

test("marking a PO received stops it counting as stock on order", async () => {
  await sql`update purchase_orders set received_at = now()`;
  await new Promise((r) => setTimeout(r, 1100));
  await runPlanning("tester");
  const snap = (await getSnapshot())!;
  assert.equal(snap.recs.find((r) => r.sku === "SKU001")?.open_po, 0);
});

test("shadow mode logs a run but leaves nothing to decide", async () => {
  await sql`insert into rules (key, value) values ('SHADOW_MODE', 'true') on conflict (key) do update set value = 'true'`;
  await new Promise((r) => setTimeout(r, 1100));
  const res = await runPlanning("tester");
  assert.equal(res.mode, "SHADOW");
  const first = (await sql`select run_id from recommendations where run_id = ${res.runId} limit 1`)[0];
  const out = await recordDecision({ run_id: res.runId!, sku: "SKU001", button: "Approve", qty: "750", reason: "", reviewer: "raghav" });
  assert.ok(first && !out.ok && /shadow/.test(out.error));
  await sql`delete from rules where key = 'SHADOW_MODE'`;
});

test("adding and removing SKUs works, and a distributor in use cannot be removed", async () => {
  const err = await store.saveSku({ sku_id: "NEW1", name: "Test Jam", category: "Spread", perishability: "Low", std_reorder_qty: 50, unit: "nos", distributor_id: "DIST001", hsn: null, unit_cost: 30, tax_pct: 12 });
  assert.equal(err, null);
  assert.equal((await sql`select name from skus where sku_id = 'NEW1'`)[0].name, "Test Jam");
  assert.equal(await store.saveSku({ sku_id: "NEW2", name: "Bad", category: null, perishability: "Medium", std_reorder_qty: 5, unit: null, distributor_id: null, hsn: null, unit_cost: null, tax_pct: null }) !== null, true);

  assert.match((await store.removeDistributor("DIST001"))!, /still ordered from this distributor/);
  await store.removeSku("NEW1", false);
  assert.equal((await sql`select active from skus where sku_id = 'NEW1'`)[0].active, false);
  await store.removeSku("NEW1", true);
  assert.equal((await sql`select count(*) as n from skus where sku_id = 'NEW1'`)[0].n.toString(), "0");
});

test("replace mode empties the dataset first; export round-trips through the importer", async () => {
  const r = await store.importDataset("calendar", "Year_Month,Is_Festival_Month\n2026-10,TRUE\n2026-11,TRUE", "replace", "tester", "cal.csv");
  assert.equal(r.imported, 2);
  assert.equal(Number((await sql`select count(*) as n from calendar_months`)[0].n), 2);
  const exp = await store.exportDataset("calendar");
  assert.equal(parseDataset("calendar", exp.csv).rows.length, 2);
  const skus = await store.exportDataset("sku_master");
  assert.equal(parseDataset("sku_master", skus.csv).rows.length, 15);
});

test("a run with too little sales data stops and says why, producing nothing", async () => {
  await sql`delete from sales_weekly where sku_id in ('SKU001','SKU002','SKU003','SKU004','SKU005','SKU006','SKU007','SKU008') and week >= '2026-W35'`; // a gap in the latest weeks for 8 SKUs
  await new Promise((r) => setTimeout(r, 1100));
  const res = await runPlanning("tester");
  assert.equal(res.ok, false);
  assert.match(res.message, /complete/);
  const snap = (await getSnapshot())!;
  assert.equal(snap.runs[0].status, "ABORTED");
});
