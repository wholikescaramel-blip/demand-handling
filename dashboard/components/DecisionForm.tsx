"use client";

import { useState, type MouseEvent } from "react";

/**
 * Approve or Reject one recommendation. The quantity box starts at the recommendation; if Raghav changes it, or rejects,
 * he must say why. The same rules are enforced on the server; this just saves a round trip.
 */
export function DecisionForm({
  action, runId, sku, recQty, kind, disabled,
}: {
  action: (formData: FormData) => void | Promise<void>;
  runId: string;
  sku: string;
  recQty: number | null; // quantity the rules recommend (0 for a pause, null for a manual review)
  kind: "REORDER" | "PAUSE" | "MANUAL_REVIEW";
  disabled?: boolean;
}) {
  const [msg, setMsg] = useState<string>("");
  const base = kind === "PAUSE" ? 0 : recQty;

  function guard(button: "Approve" | "Reject", e: MouseEvent<HTMLButtonElement>) {
    const form = e.currentTarget.form!;
    const qty = (form.elements.namedItem("qty") as HTMLInputElement).value.trim();
    const reason = (form.elements.namedItem("reason") as HTMLInputElement).value.trim();
    let problem = "";
    if (button === "Reject") {
      if (!reason) problem = "Please give a reason for rejecting.";
    } else if (qty !== "" && !/^\d+$/.test(qty)) {
      problem = "The quantity must be a whole number.";
    } else if (qty === "" && base === null) {
      problem = "Enter the quantity you want to order.";
    } else {
      const q = qty === "" ? base : Number(qty);
      if ((base === null || q !== base) && !reason) problem = base === null ? "Please say why you chose this quantity." : "You changed the quantity. Please say why.";
    }
    if (problem) {
      e.preventDefault();
      setMsg(problem);
      (form.elements.namedItem("reason") as HTMLInputElement).focus();
    } else setMsg("");
  }

  const approveLabel = kind === "PAUSE" ? "Approve: skip this order" : "Approve & create PO";
  const qtyLabel = kind === "PAUSE" ? "Order anyway? (0 = skip)" : kind === "MANUAL_REVIEW" ? "Quantity to order" : "Quantity to order";

  return (
    <form action={action} className="decide">
      <input type="hidden" name="run_id" value={runId} />
      <input type="hidden" name="sku" value={sku} />
      <label className="small dim">
        {qtyLabel}
        <input name="qty" type="number" min={0} step={1} inputMode="numeric" defaultValue={base ?? ""} placeholder={base === null ? "your call" : ""} disabled={disabled} onFocus={(e) => e.currentTarget.select()} />
      </label>
      <label className="small dim grow">
        Reason (needed to reject, or if you change the quantity)
        <input name="reason" type="text" maxLength={300} placeholder="e.g. distributor scheme starting Monday" disabled={disabled} />
      </label>
      <div className="btns">
        <button className="btn ok" type="submit" name="decision" value="Approve" disabled={disabled} onClick={(e) => guard("Approve", e)}>{approveLabel}</button>
        <button className="btn bad" type="submit" name="decision" value="Reject" disabled={disabled} onClick={(e) => guard("Reject", e)}>Reject</button>
      </div>
      {msg ? <p className="err" role="alert" style={{ flexBasis: "100%", margin: 0 }}>{msg}</p> : null}
    </form>
  );
}
