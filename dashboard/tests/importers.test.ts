import test from "node:test";
import assert from "node:assert/strict";
import { parseCsv, toCsv } from "../lib/csv.ts";
import { parseDataset } from "../lib/importers.ts";

test("parseCsv: quotes, doubled quotes, CRLF, BOM and blank lines", () => {
  const rows = parseCsv('﻿a,b,c\r\n1,"x, y","say ""hi"""\r\n\r\n3,4,5');
  assert.deepEqual(rows, [["a", "b", "c"], ["1", "x, y", 'say "hi"'], ["3", "4", "5"]]);
});

test("toCsv quotes only where needed and round-trips", () => {
  const text = toCsv(["a", "b"], [["x, y", 'q"r'], [1, null]]);
  assert.deepEqual(parseCsv(text), [["a", "b"], ["x, y", 'q"r'], ["1", ""]]);
});

test("sku_master: good rows, optional columns and clear errors for bad ones", () => {
  const r = parseDataset(
    "sku_master",
    ["SKU_ID,SKU_Name,Perishability,Standard_Reorder_Qty,Distributor_ID,Unit_Cost,Tax_Pct",
      "S1,Tea,high,100,D1,42.5,12",
      "S2,Rice,Low,abc,D1,,",
      "S3,Salt,Medium,10,D1,,",
      ",NoId,Low,5,D1,,",
      "S5,Oil,Low,20,D2,-3,"].join("\n"),
  );
  assert.equal(r.rows.length, 1);
  assert.deepEqual(r.rows[0], { sku_id: "S1", name: "Tea", category: null, perishability: "High", std_reorder_qty: 100, unit: null, distributor_id: "D1", hsn: null, unit_cost: 42.5, tax_pct: 12 });
  assert.equal(r.errorCount, 4);
  assert.match(r.errors.join("\n"), /Row 3: S2: Standard_Reorder_Qty must be a whole number/);
  assert.match(r.errors.join("\n"), /Perishability must be Low or High/);
});

test("missing required columns are reported by name and nothing is imported", () => {
  const r = parseDataset("weekly_sales", "SKU_ID,Units_Sold\nS1,5");
  assert.deepEqual(r.missingColumns, ["Week"]);
  assert.equal(r.rows.length, 0);
});

test("weekly_sales validates the week and the units, and the last duplicate wins", () => {
  const r = parseDataset("weekly_sales", "SKU_ID,Week,Units_Sold\nS1,2026-W41,10\nS1,2026-W41,12\nS1,2026-41,5\nS1,2026-W42,-1\nS1,2026-W42,7");
  assert.deepEqual(r.rows.map((x) => [x.week, x.units]), [["2026-W41", 12], ["2026-W42", 7]]);
  assert.equal(r.errorCount, 2);
});

test("current_inventory validates the date", () => {
  const r = parseDataset("current_inventory", "SKU_ID,Location,Units_On_Hand,As_Of_Date\nS1,Pune,100,2026-10-19\nS1,Pune,100,2026-13-45\nS2,,5,2026-10-19");
  assert.equal(r.rows.length, 1);
  assert.equal(r.errorCount, 2);
});

test("calendar derives year and month and accepts TRUE/FALSE", () => {
  const r = parseDataset("calendar", "Year_Month,Is_Festival_Month\n2026-10,TRUE\n2026-11,false\n2026-13,TRUE\n2026-12,maybe");
  assert.deepEqual(r.rows, [{ year_month: "2026-10", year: 2026, month: 10, is_festival: true }, { year_month: "2026-11", year: 2026, month: 11, is_festival: false }]);
  assert.equal(r.errorCount, 2);
});

test("distributor_master: status defaults to Active, bad emails are rejected, all details kept", () => {
  const r = parseDataset("distributor_master", "Distributor_ID,Distributor_Name,Email,GSTIN\nD1,Acme,po@acme.example,27ABC\nD2,Bad,not-an-email,");
  assert.equal(r.rows.length, 1);
  assert.deepEqual([r.rows[0].status, r.rows[0].email, r.rows[0].gstin], ["Active", "po@acme.example", "27ABC"]);
  assert.equal(r.errorCount, 1);
});

test("error list is capped at 20 but the count is complete", () => {
  const lines = ["SKU_ID,Week,Units_Sold", ...Array.from({ length: 50 }, (_, i) => `S${i},bad,1`)];
  const r = parseDataset("weekly_sales", lines.join("\n"));
  assert.equal(r.errors.length, 20);
  assert.equal(r.errorCount, 50);
});
