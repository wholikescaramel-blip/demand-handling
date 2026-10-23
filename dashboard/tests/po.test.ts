import test from "node:test";
import assert from "node:assert/strict";
import { aggregateOpenQty, checkDecision, formatPoNumber, groupByVendor, type PoLine } from "../lib/po.ts";
import { PDFDocument } from "pdf-lib";
import { buildPoPdf, pdfText } from "../lib/pdf.ts";

const base = { action: "REORDER", recQty: 750, button: "Approve", qty: "750", reason: "" };

test("Approve at the recommended quantity: an Approve, and a PO is READY", () => {
  assert.deepEqual(checkDecision(base), { ok: true, decision: "Approve", finalQty: 750, poStatus: "READY", reason: null });
});

test("An empty quantity box means the recommended quantity", () => {
  const r = checkDecision({ ...base, qty: "" });
  assert.ok(r.ok && r.finalQty === 750 && r.decision === "Approve");
});

test("Approve with a different quantity is recorded as an Override and needs a reason", () => {
  assert.equal(checkDecision({ ...base, qty: "900" }).ok, false);
  const r = checkDecision({ ...base, qty: "900", reason: "Scheme running" });
  assert.ok(r.ok && r.decision === "Override" && r.finalQty === 900 && r.poStatus === "READY");
});

test("The quantity must be a whole number", () => {
  for (const bad of ["-5", "12.5", "abc", "1e3"]) assert.equal(checkDecision({ ...base, qty: bad, reason: "x" }).ok, false, bad);
});

test("Reject needs a reason and never creates a PO", () => {
  assert.equal(checkDecision({ ...base, button: "Reject" }).ok, false);
  assert.equal(checkDecision({ ...base, button: "Reject", reason: "   " }).ok, false);
  const r = checkDecision({ ...base, button: "Reject", reason: "Already ordered by phone" });
  assert.ok(r.ok && r.decision === "Reject" && r.finalQty === null && r.poStatus === "NONE");
});

test("A PAUSE recommendation: Approve at 0 agrees to skip the order, a quantity orders anyway", () => {
  const pause = { action: "PAUSE", recQty: 0, button: "Approve", qty: "0", reason: "" };
  const agree = checkDecision(pause);
  assert.ok(agree.ok && agree.decision === "Approve" && agree.finalQty === 0 && agree.poStatus === "NONE");
  assert.ok(checkDecision({ ...pause, qty: "" }).ok);
  assert.equal(checkDecision({ ...pause, qty: "200" }).ok, false);
  const anyway = checkDecision({ ...pause, qty: "200", reason: "Festival stock needed" });
  assert.ok(anyway.ok && anyway.decision === "Override" && anyway.poStatus === "READY");
});

test("Changing the quantity to 0 records the change but orders nothing", () => {
  const r = checkDecision({ ...base, qty: "0", reason: "Enough stock on the shelf" });
  assert.ok(r.ok && r.decision === "Override" && r.finalQty === 0 && r.poStatus === "NONE");
});

test("A manual-review row has no recommendation, so Raghav must type a quantity and a reason", () => {
  const m = { action: "MANUAL_REVIEW", recQty: null, button: "Approve", qty: "", reason: "" };
  assert.equal(checkDecision(m).ok, false);
  assert.equal(checkDecision({ ...m, qty: "200" }).ok, false);
  const r = checkDecision({ ...m, qty: "200", reason: "New launch, planning 200" });
  assert.ok(r.ok && r.decision === "Override" && r.poStatus === "READY");
});

test("An unknown button is refused", () => {
  assert.equal(checkDecision({ ...base, button: "Maybe" }).ok, false);
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

import { lineAmount, poOptionsFromEnv, DEFAULT_TERMS } from "../lib/pdf.ts";
import { validEmail } from "../lib/mail.ts";

test("lineAmount: quantity x rate x (1 + tax), or null without a rate", () => {
  assert.equal(lineAmount({ qty: 20, rate: 600, tax_pct: 5 }), 12600);
  assert.equal(lineAmount({ qty: 10, rate: 50 }), 500);
  assert.equal(lineAmount({ qty: 10, rate: null }), null);
});

test("poOptionsFromEnv: defaults, and values from the environment", () => {
  const d = poOptionsFromEnv({});
  assert.equal(d.company?.name, "Freshroots");
  assert.deepEqual(d.shipTo, ["Freshroots", "Pune Central Warehouse, Pune"]);
  assert.equal(d.expiryDays, 7);
  assert.deepEqual(d.terms, DEFAULT_TERMS);
  const e = poOptionsFromEnv({ COMPANY_NAME: "Acme", SHIP_TO: "Acme|Plot 4|Nashik", PO_EXPIRY_DAYS: "10", PO_TERMS: "One|Two", PAYMENT_TERMS: "Net 30" });
  assert.deepEqual(e.shipTo, ["Acme", "Plot 4", "Nashik"]);
  assert.equal(e.expiryDays, 10);
  assert.deepEqual(e.terms, ["One", "Two"]);
  assert.equal(e.paymentTerms, "Net 30");
});

test("buildPoPdf renders a priced PO with vendor details", async () => {
  const bytes = await buildPoPdf(
    {
      po_number: "DP-2026-0002", created_at: "2026-10-23T09:15:00+05:30", vendor_name: "GrainPath Logistics", vendor_key: "DIST002",
      vendor: { key: "DIST002", name: "GrainPath Logistics", address: "12 Market Road, Pune", gstin: "27ABCDE1234F1Z5", contact: "+91 98000 00000", email: "po@grainpath.example" },
      run_ids: "R1", created_by: "Raghav", total_qty: 300, total_amount: 300 * 40 * 1.05,
      lines: [{ run_id: "R1", sku: "SKU003", name: "Freshroots Brown Rice 1kg", qty: 300, unit: "nos", hsn: "10063020", rate: 40, tax_pct: 5 }],
    },
    { company: { name: "Freshroots", email: "purchase@freshroots.example" } },
  );
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), "%PDF-");
  assert.equal((await PDFDocument.load(bytes)).getPageCount(), 1);
});

test("validEmail accepts normal addresses and rejects junk", () => {
  assert.equal(validEmail("vendor@example.com"), true);
  assert.equal(validEmail(" vendor@example.co.in "), true);
  assert.equal(validEmail("vendor@"), false);
  assert.equal(validEmail("not an email"), false);
});
