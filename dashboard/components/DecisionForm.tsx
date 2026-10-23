"use client";

import { useState, type MouseEvent } from "react";

type Mode = "idle" | "edit" | "reject";

/**
 * Approve, Edit or Reject one recommendation.
 *  - Approve: order exactly what the rules recommend (for a pause: skip the order).
 *  - Edit: order a different quantity; a reason is required.
 *  - Reject: no order; a reason is required.
 * The same rules are enforced on the server; this just saves a round trip.
 */
export function DecisionForm({
  action, runId, sku, recQty, kind,
}: {
  action: (formData: FormData) => void | Promise<void>;
  runId: string;
  sku: string;
  recQty: number | null; // quantity the rules recommend (null for a manual review)
  kind: "REORDER" | "PAUSE" | "MANUAL_REVIEW";
}) {
  const [mode, setMode] = useState<Mode>("idle");
  const [msg, setMsg] = useState("");
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

  const go = (m: Mode) => { setMode(m); setMsg(""); };
  const approveLabel = kind === "PAUSE" ? "Approve: skip this order" : "Approve";
  const editLabel = kind === "PAUSE" ? "Order anyway" : kind === "MANUAL_REVIEW" ? "Set quantity" : "Edit";

  return (
    <form action={action} className="decide">
      <input type="hidden" name="run_id" value={runId} />
      <input type="hidden" name="sku" value={sku} />

      {/* the quantity box always exists so Approve sends the recommended quantity; it is only shown while editing */}
      <label className="small dim" hidden={mode !== "edit"}>
        Quantity to order
        <input name="qty" type="number" min={0} step={1} inputMode="numeric" defaultValue={base ?? ""} placeholder={base === null ? "your call" : ""} onFocus={(e) => e.currentTarget.select()} />
      </label>
      <label className="small dim grow" hidden={mode === "idle"}>
        {mode === "reject" ? "Why are you rejecting it?" : "Why are you changing the quantity?"}
        <input name="reason" type="text" maxLength={300} placeholder="e.g. distributor scheme starting Monday" />
      </label>

      <div className="btns">
        {mode === "idle" ? (
          <>
            {kind !== "MANUAL_REVIEW" ? <button className="btn ok" type="submit" name="decision" value="Approve" onClick={(e) => guard("Approve", e)}>{approveLabel}</button> : null}
            <button className="btn" type="button" onClick={() => go("edit")}>{editLabel}</button>
            <button className="btn bad" type="button" onClick={() => go("reject")}>Reject</button>
          </>
        ) : mode === "edit" ? (
          <>
            <button className="btn ok" type="submit" name="decision" value="Approve" onClick={(e) => guard("Approve", e)}>Save and approve</button>
            <button className="btn" type="button" onClick={() => go("idle")}>Cancel</button>
          </>
        ) : (
          <>
            <button className="btn bad" type="submit" name="decision" value="Reject" onClick={(e) => guard("Reject", e)}>Confirm reject</button>
            <button className="btn" type="button" onClick={() => go("idle")}>Cancel</button>
          </>
        )}
      </div>
      {msg ? <p className="err" role="alert" style={{ flexBasis: "100%", margin: 0 }}>{msg}</p> : null}
    </form>
  );
}
