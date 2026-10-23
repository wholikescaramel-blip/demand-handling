import { getSql } from "./db.ts";
import { formatPoNumber, groupByVendor, type PoLine } from "./po.ts";
import { lineAmount } from "./pdf.ts";

export type GenerateResult = {
  created: { po_number: string; vendor: string; lines: number; qty: number }[];
  failed: { vendor: string; error: string }[];
};

/**
 * Turns approved lines that are still READY into numbered purchase orders. With `only`, just that one line (this is what
 * happens the moment Raghav presses Approve: one approval, one PO). Without it, every READY line (a retry of any that
 * failed). Lines are claimed first (marked CREATED) so two simultaneous calls can never put a line on two POs; if
 * anything goes wrong, the lines go back to READY and the next call retries them.
 */
export async function generatePosForReady(only?: { run_id: string; sku: string }): Promise<GenerateResult> {
  const sql = getSql();
  const result: GenerateResult = { created: [], failed: [] };
  const rid = only?.run_id ?? null;
  const sk = only?.sku ?? null;

  const claimed = await sql`
    update decisions d set po_status = 'CREATED', po_created_at = now()
    from recommendations r
    where r.run_id = d.run_id and r.sku = d.sku and d.po_status = 'READY' and d.final_qty > 0
      and (${rid}::text is null or d.run_id = ${rid}) and (${sk}::text is null or d.sku = ${sk})
    returning d.run_id, d.sku, d.final_qty, d.reviewer, r.name, r.distributor_id, r.distributor_name, r.unit, r.hsn, r.unit_cost, r.tax_pct`;

  // Vendor details (address, GSTIN, contact, email) as they are right now; frozen into each PO.
  const vendorRows = await sql`select * from distributors`;
  const vendorBy = new Map(vendorRows.map((v) => [String(v.distributor_id), v]));

  const lines: (PoLine & { reviewer: string | null })[] = claimed.map((c) => ({
    run_id: c.run_id, sku: c.sku, name: c.name, qty: Number(c.final_qty),
    vendor_key: c.distributor_id ?? "UNKNOWN", vendor_name: c.distributor_name ?? null, reviewer: c.reviewer,
    unit: c.unit ?? null, hsn: c.hsn ?? null,
    rate: c.unit_cost === null || c.unit_cost === undefined ? null : Number(c.unit_cost),
    tax_pct: c.tax_pct === null || c.tax_pct === undefined ? null : Number(c.tax_pct),
  }));

  for (const group of groupByVendor(lines)) {
    const vendor = group.name ?? group.key;
    try {
      const [{ seq }] = await sql`select nextval('po_seq') as seq`;
      const po_number = formatPoNumber(Number(seq));
      const qty = group.lines.reduce((s, l) => s + l.qty, 0);
      const runIds = [...new Set(group.lines.map((l) => l.run_id))].join(", ");
      const approvers = [...new Set((group.lines as (PoLine & { reviewer: string | null })[]).map((l) => l.reviewer).filter(Boolean))].join(", ");
      const snapshot = JSON.stringify(
        group.lines.map((l) => ({
          run_id: l.run_id, sku: l.sku, name: l.name, qty: l.qty, unit: l.unit ?? null, hsn: l.hsn ?? null, rate: l.rate ?? null, tax_pct: l.tax_pct ?? null,
        })),
      );
      const v = vendorBy.get(group.key);
      const vendorJson = JSON.stringify({
        key: group.key, name: (v?.name as string | undefined) ?? group.name, address: v?.address ?? null, gstin: v?.gstin ?? null,
        contact: v?.contact ?? null, email: v?.email ?? null,
      });
      const priced = group.lines.every((l) => l.rate != null);
      const totalAmount = priced ? group.lines.reduce((s, l) => s + (lineAmount({ qty: l.qty, rate: l.rate, tax_pct: l.tax_pct }) ?? 0), 0) : null;

      await sql`
        insert into purchase_orders (po_number, vendor_key, vendor_name, vendor, run_ids, created_by, total_qty, total_amount, lines)
        values (${po_number}, ${group.key}, ${group.name}, ${vendorJson}::jsonb, ${runIds}, ${approvers || null}, ${qty}, ${totalAmount},
                ${snapshot}::jsonb)`;
      for (const l of group.lines) {
        await sql`update decisions set po_number = ${po_number}, po_vendor = ${vendor} where run_id = ${l.run_id} and sku = ${l.sku}`;
      }
      result.created.push({ po_number, vendor, lines: group.lines.length, qty });
    } catch (e) {
      for (const l of group.lines) {
        await sql`update decisions set po_status = 'READY', po_created_at = null where run_id = ${l.run_id} and sku = ${l.sku} and po_number is null`;
      }
      result.failed.push({ vendor, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return result;
}
