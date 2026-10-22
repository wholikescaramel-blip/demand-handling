import test from "node:test";
import assert from "node:assert/strict";
import { checkDecision, groupByVendor, type PoLine } from "../lib/po.ts";
import { buildPoPayload, isOpenStatus, openQtyByLine, zohoCfg } from "../lib/zoho.ts";

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

test("buildPoPayload: vendor, line items, optional rate and number", () => {
  const p = buildPoPayload({
    vendorId: "V1", date: "2026-10-23", reference: "DP-R1", notes: "Approved by raghav",
    lines: [{ item_id: "I1", quantity: 750, purchase_rate: 42, name: "Mango Drink" }, { item_id: "I2", quantity: 120, purchase_rate: null, name: "Peanut Butter" }],
  });
  assert.equal(p.vendor_id, "V1");
  assert.equal(p.purchaseorder_number, undefined);
  assert.deepEqual(p.line_items[0], { item_id: "I1", name: "Mango Drink", quantity: 750, purchase_rate: 42 });
  assert.equal("purchase_rate" in p.line_items[1], false);
  const numbered = buildPoPayload({ vendorId: "V1", date: "2026-10-23", reference: "r", notes: "n", number: "DP-1", lines: [] });
  assert.equal(numbered.purchaseorder_number, "DP-1");
});

test("openQtyByLine counts only what is still to be received and maps item ids to SKUs", () => {
  const map = new Map([["I9", "SKU009"]]);
  const out = openQtyByLine(
    { line_items: [{ sku: "SKU001", quantity: 500, quantity_received: 200 }, { item_id: "I9", quantity: 80 }, { sku: "SKU002", quantity: 10, quantity_received: 10 }, { item_id: "??", quantity: 5 }] },
    map,
  );
  assert.deepEqual(out, [{ sku: "SKU001", open: 300 }, { sku: "SKU009", open: 80 }]);
});

test("isOpenStatus treats draft and open as on order, billed and cancelled as closed", () => {
  assert.equal(isOpenStatus("draft"), true);
  assert.equal(isOpenStatus("open"), true);
  assert.equal(isOpenStatus("Billed"), false);
  assert.equal(isOpenStatus("cancelled"), false);
});

test("zohoCfg is null until every credential is set, and defaults to draft POs in India", () => {
  assert.equal(zohoCfg({}), null);
  const c = zohoCfg({ ZOHO_CLIENT_ID: "a", ZOHO_CLIENT_SECRET: "b", ZOHO_REFRESH_TOKEN: "c", ZOHO_ORG_ID: "d", ZOHO_VENDOR_MAP: '{"DIST001":"V1"}' });
  assert.ok(c);
  assert.equal(c.dc, "in");
  assert.equal(c.poStatus, "draft");
  assert.equal(c.vendorMap.DIST001, "V1");
  assert.equal(zohoCfg({ ZOHO_CLIENT_ID: "a", ZOHO_CLIENT_SECRET: "b", ZOHO_REFRESH_TOKEN: "c", ZOHO_ORG_ID: "d", ZOHO_PO_STATUS: "issued" })!.poStatus, "issued");
});
