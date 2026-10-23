import { sendPoEmail } from "@/app/review/actions";
import type { PurchaseOrder } from "@/lib/types";

/** The two things you do with a PO once it exists: download it, or email it. */
export function PoActions({
  po, emailOn, defaultTo, from,
}: {
  po: PurchaseOrder;
  emailOn: boolean;
  defaultTo: string;
  from: "review" | "orders";
}) {
  const enabled = emailOn;
  return (
    <div className="poactions">
      <div className="btns">
        <a className="btn primary" href={`/api/po/${po.po_number}?download=1`}>Download PDF</a>
        <a className="btn" href={`/api/po/${po.po_number}`} target="_blank" rel="noreferrer">Preview</a>
      </div>
      <form action={sendPoEmail} className="emailrow">
        <input type="hidden" name="po_number" value={po.po_number} />
        <input type="hidden" name="from" value={from} />
        <label className="small dim grow">
          Email to
          <input name="to" type="email" defaultValue={defaultTo} placeholder="vendor@example.com" required disabled={!enabled} />
        </label>
        <button className="btn" type="submit" disabled={!enabled} title={enabled ? "" : "Email is not set up yet"}>
          Send by email
        </button>
      </form>
      <div className="small dim">
        {po.sent_at ? `Emailed to ${po.sent_to}.` : enabled ? "Not emailed yet." : "Email is not set up, so use Download PDF."}
      </div>
    </div>
  );
}
