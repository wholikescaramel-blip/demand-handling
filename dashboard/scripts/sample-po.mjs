// Writes docs/sample_purchase_order.pdf with ILLUSTRATIVE vendor details and rates, to eyeball the layout:
//   node scripts/sample-po.mjs
import { writeFileSync } from "node:fs";
const { buildPoPdf } = await import("../lib/pdf.ts");

const po = {
  po_number: "DP-2026-0001",
  created_at: "2026-10-23T09:15:00+05:30",
  vendor_key: "DIST001",
  vendor_name: "NutriFlow Distributors",
  vendor: {
    key: "DIST001", name: "NutriFlow Distributors", address: "Sample address, Pune - 411001", gstin: "SAMPLE-GSTIN",
    contact: "+91-00000-00000", email: "orders@vendor.example",
  },
  run_ids: "R20261023-0800",
  created_by: "Raghav Kulkarni",
  total_qty: 870,
  lines: [
    { run_id: "R1", sku: "SKU001", name: "Freshroots Mango Drink 200ml", qty: 750, unit: "nos", hsn: "22029990", rate: 18, tax_pct: 12 },
    { run_id: "R1", sku: "SKU013", name: "Freshroots Peanut Butter 300g", qty: 120, unit: "nos", hsn: "20081100", rate: 96, tax_pct: 12 },
  ],
};
po.total_amount = po.lines.reduce((s, l) => s + l.qty * l.rate * (1 + l.tax_pct / 100), 0);

const bytes = await buildPoPdf(po, {
  company: { name: "Freshroots", address: "Sample address, Pune", gstin: "SAMPLE-GSTIN", contact: "+91-00000-00000", email: "purchase@freshroots.example" },
  shipTo: ["Freshroots", "Pune Central Warehouse, Pune"],
  paymentTerms: "100% against invoice (sample)",
  watermark: "SAMPLE",
});
writeFileSync(new URL("../../docs/sample_purchase_order.pdf", import.meta.url), bytes);
console.log("wrote docs/sample_purchase_order.pdf");
