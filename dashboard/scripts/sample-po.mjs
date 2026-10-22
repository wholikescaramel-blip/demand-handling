// Writes docs/sample_purchase_order.pdf from the demo data, to eyeball the layout: node scripts/sample-po.mjs
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const demo = createRequire(import.meta.url)("../lib/demo-data.json");
const { buildPoPdf } = await import("../lib/pdf.ts");
const po = demo.pos[0];
writeFileSync(new URL("../../docs/sample_purchase_order.pdf", import.meta.url), await buildPoPdf(po));
console.log("wrote docs/sample_purchase_order.pdf for", po.po_number);
