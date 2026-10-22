import test from "node:test";
import assert from "node:assert/strict";
import { aggregateOpenQty, checkDecision, formatPoNumber, groupByVendor, type PoLine } from "../lib/po.ts";
import { PDFDocument } from "pdf-lib";
import { buildPoPdf, pdfText } from "../lib/pdf.ts";

const base = { action: "REORDER", recQty: 750, decision: "Approve", overrideQty: "", reason: "" };

test("Approve a REORDER: final qty is the recommendation and a PO is READY", () => {
  const r = checkDecision(base);
  assert.deepEqual(r, { ok: true, decision: "Approve", finalQty: 750, poStatus: "READY", reason: null });
});

test("Approve a PAUSE: nothing to order", () => {
  const r = checkDecision({ ...base, action: "PAUSE", recQty: 0 });
  assert.ok(r.ok && r.finalQty === 0 && r.poStatus === "NONE");
});

test("Reject needs a reason and never creates a PO", () => {
  assert.equal(checkDecision({ ...base, decision: "Reject" }).ok, false);
  const r = checkDecision({ ...base, decision: "Reject", reason: "Already ordered by phone" });
  assert.ok(r.ok && r.finalQty === null && r.poStatus === "NONE");
});

test("Override needs a whole-number qty and a reason", () => {
  assert.equal(checkDecision({ ...base, decision: "Override", reason: "x" }).ok, false);
  assert.equal(checkDecision({ ...base, decision: "Override", overrideQty: "-5", reason: "x" }).ok, false);
  assert.equal(checkDecision({ ...base, decision: "Override", overrideQty: "12.5", reason: "x" }).ok, false);
  assert.equal(checkDecision({ ...base, decision: "Override", overrideQty: "900" }).ok, false);
  const r = checkDecision({ ...base, decision: "Override", overrideQty: "900", reason: "Scheme running" });
  assert.ok(r.ok && r.finalQty === 900 && r.poStatus === "READY");
});

test("Override to 0 records the change but orders nothing", () => {
  const r = checkDecision({ ...base, decision: "Override", overrideQty: "0", reason: "Enough stock on the shelf" });
  assert.ok(r.ok && r.finalQty === 0 && r.poStatus === "NONE");
});

test("A manual-review row cannot be approved as is, but can be overridden with a quantity", () => {
  const m = { ...base, action: "MANUAL_REVIEW", recQty: null };
  assert.equal(checkDecision(m).ok, false);
  const r = checkDecision({ ...m, decision: "Override", overrideQty: "200", reason: "New launch, planning 200" });
  assert.ok(r.ok && r.poStatus === "READY");
});

const line = (sku: string, vendor: string, qty = 100): PoLine => ({ run_id: "R1", sku, name: sku, qty, vendor_key: vendor, vendor_name: vendor });

test("groupByVendor makes one PO per vendor with stable ordering", () => {
  const groups = groupByVendor([line("SKU013", "DIST001"), line("SKU003", "DIST002"), line("SKU001", "DIST001")]);
  assert.deepEqual(groups.map((g) => [g.key, g.lines.map((l) => l.sku)]), [
    ["DIST001", ["SKU001", "SKU013"]],
    ["DIST002", ["SKU003"]],
  ]);
});

test("formatPoNumber: year plus a zero-padded sequence", () => {
  assert.equal(formatPoNumber(7, new Date("2026-10-23T00:00:00Z")), "DP-2026-0007");
  assert.equal(formatPoNumber(12345, new Date("2027-01-02T00:00:00Z")), "DP-2027-12345");
});

test("aggregateOpenQty counts unreceived, recent POs only and sums per SKU", () => {
  const now = new Date("2026-10-30T00:00:00Z").getTime();
  const out = aggregateOpenQty(
    [
      { created_at: "2026-10-25T00:00:00Z", received_at: null, lines: [{ sku: "SKU001", qty: 750 }, { sku: "SKU003", qty: 300 }] },
      { created_at: "2026-10-27T00:00:00Z", received_at: null, lines: [{ sku: "SKU001", qty: 100 }] },
      { created_at: "2026-10-26T00:00:00Z", received_at: "2026-10-29T00:00:00Z", lines: [{ sku: "SKU009", qty: 80 }] },
      { created_at: "2026-08-01T00:00:00Z", received_at: null, lines: [{ sku: "SKU013", qty: 120 }] },
    ],
    21,
    now,
  );
  assert.deepEqual(out, [{ sku: "SKU001", qty_on_order: 850 }, { sku: "SKU003", qty_on_order: 300 }]);
});

test("pdfText maps typographic characters and drops anything the PDF fonts cannot draw", () => {
  assert.equal(pdfText("Raghav’s “plan” – 5 · units…"), "Raghav's \"plan\" - 5 - units...");
  assert.equal(pdfText("Tea ☕ 25 bags"), "Tea  25 bags");
});

test("buildPoPdf produces a real PDF, including a long multi-page order", async () => {
  const mk = (n: number) => ({
    po_number: "DP-2026-0001", created_at: "2026-10-23T09:15:00+05:30", vendor_name: "NutriFlow Distributors", vendor_key: "DIST001",
    run_ids: "R20261023-0800", created_by: "raghav", total_qty: n * 10,
    lines: Array.from({ length: n }, (_, i) => ({ sku: `SKU${String(i + 1).padStart(3, "0")}`, name: "Freshroots Mango Drink 200ml", qty: 10, run_id: "R1" })),
  });
  const small = await buildPoPdf(mk(3));
  assert.equal(Buffer.from(small.slice(0, 5)).toString(), "%PDF-");
  assert.ok(small.length > 1500);
  const big = await buildPoPdf(mk(70));
  assert.ok(big.length > small.length);
  const pages = (await PDFDocument.load(big)).getPageCount();
  assert.ok(pages >= 3, `expected a multi-page PO, got ${pages}`);
  assert.equal((await PDFDocument.load(small)).getPageCount(), 1);
});
