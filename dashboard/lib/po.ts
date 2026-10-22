/** Pure decision and purchase-order logic. No network, no database: unit-tested. */

export type PoStatus = "NONE" | "READY" | "PENDING" | "CREATED" | "FAILED";

export type DecisionInput = {
  action: string; // REORDER | PAUSE | MANUAL_REVIEW
  recQty: number | null;
  decision: string; // Approve | Override | Reject
  overrideQty: string;
  reason: string;
};

export type DecisionCheck =
  | { ok: true; decision: "Approve" | "Override" | "Reject"; finalQty: number | null; poStatus: PoStatus; reason: string | null }
  | { ok: false; error: string };

/**
 * The review gate. Reject and Override need a reason (that is the kill switch and the feedback signal).
 * A manual-review row has no quantity to approve, so it must be overridden with one or rejected.
 * Only a decision that ends with a quantity above zero is READY for a purchase order.
 */
export function checkDecision(i: DecisionInput): DecisionCheck {
  const reason = i.reason.trim();
  if (i.decision === "Reject") {
    if (!reason) return { ok: false, error: "Reject needs a reason." };
    return { ok: true, decision: "Reject", finalQty: null, poStatus: "NONE", reason };
  }
  if (i.decision === "Override") {
    const raw = i.overrideQty.trim();
    if (raw === "" || !/^\d+$/.test(raw)) return { ok: false, error: "Override needs a whole-number quantity (0 or more)." };
    if (!reason) return { ok: false, error: "Override needs a reason." };
    const qty = Number(raw);
    return { ok: true, decision: "Override", finalQty: qty, poStatus: qty > 0 ? "READY" : "NONE", reason };
  }
  if (i.decision === "Approve") {
    if (i.action === "MANUAL_REVIEW") return { ok: false, error: "A manual-review row has no quantity to approve. Override with a quantity, or reject." };
    if (i.action === "PAUSE") return { ok: true, decision: "Approve", finalQty: 0, poStatus: "NONE", reason: reason || null };
    const qty = i.recQty ?? 0;
    return { ok: true, decision: "Approve", finalQty: qty, poStatus: qty > 0 ? "READY" : "NONE", reason: reason || null };
  }
  return { ok: false, error: "Unknown decision." };
}

export type PoLine = {
  run_id: string;
  sku: string;
  name: string | null;
  qty: number;
  vendor_key: string; // distributor id from SKU master
  vendor_name: string | null;
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
