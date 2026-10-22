import { neon } from "@neondatabase/serverless";
import { groupByVendor, type PoLine } from "./po.ts";
import { buildPoPayload, createPurchaseOrder, findItemBySku, resolveVendor, zohoCfg } from "./zoho.ts";

export type CreateResult = {
  configured: boolean;
  created: { po_number: string; vendor: string; lines: number }[];
  failed: { vendor: string; sku?: string; error: string }[];
};

const istDate = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()); // yyyy-mm-dd

/**
 * Turns every approved line that is READY (or FAILED, for a retry) into Zoho purchase orders, one per vendor.
 * Lines are claimed first (status PENDING) so a double click cannot create the same PO twice.
 */
export async function createPosForReady(): Promise<CreateResult> {
  const cfg = zohoCfg();
  if (!cfg) return { configured: false, created: [], failed: [] };
  const sql = neon(process.env.DATABASE_URL!);

  const claimed = await sql`
    update decisions d set po_status = 'PENDING', po_error = null
    from recommendations r
    where r.run_id = d.run_id and r.sku = d.sku and d.po_status in ('READY', 'FAILED') and d.final_qty > 0
    returning d.run_id, d.sku, d.final_qty, d.reviewer, r.name, r.distributor_id, r.distributor_name`;

  const lines: (PoLine & { reviewer: string | null })[] = claimed.map((c) => ({
    run_id: c.run_id, sku: c.sku, name: c.name, qty: Number(c.final_qty),
    vendor_key: c.distributor_id ?? "UNKNOWN", vendor_name: c.distributor_name ?? null, reviewer: c.reviewer,
  }));
  const result: CreateResult = { configured: true, created: [], failed: [] };

  const fail = async (l: PoLine, error: string) => {
    await sql`update decisions set po_status = 'FAILED', po_error = ${error.slice(0, 300)} where run_id = ${l.run_id} and sku = ${l.sku}`;
  };

  for (const group of groupByVendor(lines)) {
    const vendorLabel = group.name ?? group.key;
    try {
      const vendorId = await resolveVendor(cfg, group.key, group.name);
      const ok: { line: PoLine; item_id: string; name: string; rate: number | null }[] = [];
      for (const l of group.lines) {
        try {
          const item = await findItemBySku(cfg, l.sku);
          ok.push({ line: l, item_id: item.item_id, name: item.name, rate: item.purchase_rate });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          await fail(l, msg);
          result.failed.push({ vendor: vendorLabel, sku: l.sku, error: msg });
        }
      }
      if (!ok.length) continue;

      const reviewers = [...new Set(lines.filter((l) => l.vendor_key === group.key).map((l) => l.reviewer).filter(Boolean))].join(", ");
      const runIds = [...new Set(ok.map((o) => o.line.run_id))].join(", ");
      const prefix = cfg.numberPrefix ? `${cfg.numberPrefix}-${istDate().replaceAll("-", "")}-${group.key}` : null;
      const payload = buildPoPayload({
        vendorId, date: istDate(), reference: `DP-${runIds}`.slice(0, 50),
        notes: `Created by Demand Planning Desk after approval by ${reviewers || "reviewer"}.`,
        number: prefix,
        lines: ok.map((o) => ({ item_id: o.item_id, quantity: o.line.qty, purchase_rate: o.rate, name: o.name })),
      });
      const po = await createPurchaseOrder(cfg, payload);
      for (const o of ok) {
        await sql`
          update decisions set po_status = 'CREATED', po_number = ${po.po_number}, po_id = ${po.po_id}, po_vendor = ${vendorLabel},
                               po_error = null, po_created_at = now()
          where run_id = ${o.line.run_id} and sku = ${o.line.sku}`;
      }
      result.created.push({ po_number: po.po_number, vendor: vendorLabel, lines: ok.length });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      for (const l of group.lines) {
        await sql`update decisions set po_status = 'FAILED', po_error = ${msg.slice(0, 300)} where run_id = ${l.run_id} and sku = ${l.sku} and po_status = 'PENDING'`;
      }
      result.failed.push({ vendor: vendorLabel, error: msg });
    }
  }
  return result;
}
