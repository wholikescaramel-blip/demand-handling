/** Pure decision and purchase-order logic. No network, no database: unit-tested. */

export type PoStatus = "NONE" | "READY" | "CREATED";

export type DecisionInput = {
  action: string; // REORDER | PAUSE | MANUAL_REVIEW: what the rules recommended
  recQty: number | null; // the recommended quantity (null for a manual-review row)
  button: string; // Approve | Reject: the button Raghav pressed
  qty: string; // the quantity in the box (pre-filled with the recommendation)
  reason: string;
};

export type DecisionCheck =
  | { ok: true; decision: "Approve" | "Override" | "Reject"; finalQty: number | null; poStatus: PoStatus; reason: string | null }
  | { ok: false; error: string };

/**
 * The review gate: Raghav presses Approve or Reject, nothing else.
 * - Reject needs a reason and never creates a PO.
 * - Approve orders the quantity in the box. If it is the recommended quantity the decision is "Approve"; if Raghav typed
 *   a different one it is recorded as "Override" and needs a reason (that reason is the feedback the rules learn from).
 * - A PAUSE recommendation is pre-filled with 0: Approve agrees to skip the order; typing a quantity orders anyway.
 * - A manual-review row has no recommended quantity, so Raghav must type one (and say why).
 * Only a decision that ends with a quantity above zero is READY for a purchase order.
 */
export function checkDecision(i: DecisionInput): DecisionCheck {
  const reason = i.reason.trim();
  if (i.button === "Reject") {
    if (!reason) return { ok: false, error: "Please give a reason for rejecting." };
    return { ok: true, decision: "Reject", finalQty: null, poStatus: "NONE", reason };
  }
  if (i.button !== "Approve") return { ok: false, error: "Unknown decision." };

  const base = i.action === "PAUSE" ? 0 : i.recQty;
  const raw = i.qty.trim();
  if (raw === "") {
    if (base === null) return { ok: false, error: "Enter the quantity you want to order." };
  } else if (!/^\d+$/.test(raw)) {
    return { ok: false, error: "The quantity must be a whole number (0 or more)." };
  }
  const qty = raw === "" ? (base as number) : Number(raw);
  const changed = base === null || qty !== base;
  if (changed && !reason) {
    return { ok: false, error: base === null ? "Please say why you chose this quantity." : "You changed the quantity. Please say why." };
  }
  return { ok: true, decision: changed ? "Override" : "Approve", finalQty: qty, poStatus: qty > 0 ? "READY" : "NONE", reason: reason || null };
}

export type PoLine = {
  run_id: string;
  sku: string;
  name: string | null;
  qty: number;
  vendor_key: string; // distributor id from SKU master
  vendor_name: string | null;
  unit?: string | null;
  hsn?: string | null;
  rate?: number | null; // purchase rate per unit (sku_master Unit_Cost)
  tax_pct?: number | null;
};

export type VendorGroup = { key: string; name: string | null; lines: PoLine[] };

/** One purchase order per vendor. Stable order: vendor key, then SKU. */
export function groupByVendor(lines: PoLine[]): VendorGroup[] {
  const by = new Map<string, VendorGroup>();
  for (const l of lines) {
    const key = l.vendor_key || "UNKNOWN";
    const g = by.get(key) ?? { key, name: l.vendor_name, lines: [] };
    g.lines.push(l);
    by.set(key, g);
  }
  return [...by.values()]
    .sort((a, b) => (a.key < b.key ? -1 : 1))
    .map((g) => ({ ...g, lines: g.lines.sort((a, b) => (a.sku < b.sku ? -1 : 1)) }));
}

/** DP-2026-0007: year plus a zero-padded sequence that never repeats (Postgres sequence). */
export function formatPoNumber(seq: number, date: Date = new Date()): string {
  return `DP-${date.getUTCFullYear()}-${String(seq).padStart(4, "0")}`;
}

export type OpenPoInput = { created_at: string; received_at: string | null; lines: { sku: string; qty: number }[] };

/** Stock on order: lines of POs not yet marked received and created within the last `days` days. */
export function aggregateOpenQty(pos: OpenPoInput[], days: number, now: number = Date.now()): { sku: string; qty_on_order: number }[] {
  const since = now - days * 86400000;
  const by = new Map<string, number>();
  for (const po of pos) {
    if (po.received_at || new Date(po.created_at).getTime() < since) continue;
    for (const l of po.lines) by.set(l.sku, (by.get(l.sku) ?? 0) + l.qty);
  }
  return [...by.entries()].map(([sku, qty_on_order]) => ({ sku, qty_on_order })).sort((a, b) => (a.sku < b.sku ? -1 : 1));
}
