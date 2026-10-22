import { neon } from "@neondatabase/serverless";
import { formatPoNumber, groupByVendor, type PoLine } from "./po.ts";

export type GenerateResult = {
  created: { po_number: string; vendor: string; lines: number; qty: number }[];
  failed: { vendor: string; error: string }[];
};

/**
 * Turns every approved line that is still READY into a numbered purchase order, one per vendor.
 * Lines are claimed first (marked CREATED) so two simultaneous calls can never put a line on two POs;
 * if anything goes wrong for a vendor, its lines go back to READY and the next call retries them.
 */
export async function generatePosForReady(): Promise<GenerateResult> {
  const sql = neon(process.env.DATABASE_URL!);
  const result: GenerateResult = { created: [], failed: [] };

  const claimed = await sql`
    update decisions d set po_status = 'CREATED', po_created_at = now()
    from recommendations r
    where r.run_id = d.run_id and r.sku = d.sku and d.po_status = 'READY' and d.final_qty > 0
    returning d.run_id, d.sku, d.final_qty, d.reviewer, r.name, r.distributor_id, r.distributor_name`;

  const lines: (PoLine & { reviewer: string | null })[] = claimed.map((c) => ({
    run_id: c.run_id, sku: c.sku, name: c.name, qty: Number(c.final_qty),
    vendor_key: c.distributor_id ?? "UNKNOWN", vendor_name: c.distributor_name ?? null, reviewer: c.reviewer,
  }));

  for (const group of groupByVendor(lines)) {
    const vendor = group.name ?? group.key;
    try {
      const [{ seq }] = await sql`select nextval('po_seq') as seq`;
      const po_number = formatPoNumber(Number(seq));
      const qty = group.lines.reduce((s, l) => s + l.qty, 0);
      const runIds = [...new Set(group.lines.map((l) => l.run_id))].join(", ");
      const approvers = [...new Set((group.lines as (PoLine & { reviewer: string | null })[]).map((l) => l.reviewer).filter(Boolean))].join(", ");
      const snapshot = JSON.stringify(group.lines.map((l) => ({ run_id: l.run_id, sku: l.sku, name: l.name, qty: l.qty })));

      await sql`
        insert into purchase_orders (po_number, vendor_key, vendor_name, run_ids, created_by, total_qty, lines)
        values (${po_number}, ${group.key}, ${group.name}, ${runIds}, ${approvers || null}, ${qty}, ${snapshot}::jsonb)`;
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

/** Called after each decision: once nothing is left undecided in the run, its approved lines become POs automatically. */
export async function generateIfRunComplete(run_id: string): Promise<GenerateResult | null> {
  const sql = neon(process.env.DATABASE_URL!);
  const [{ pending }] = await sql`
    select count(*) as pending from recommendations r
    where r.run_id = ${run_id} and not exists (select 1 from decisions d where d.run_id = r.run_id and d.sku = r.sku)`;
  if (Number(pending) > 0) return null;
  return generatePosForReady();
}
