import type { PurchaseOrder } from "@/lib/types";

/** What you do with a PO once it exists: open it or download the PDF. */
export function PoActions({ po }: { po: PurchaseOrder }) {
  return (
    <div className="btns">
      <a className="btn primary" href={`/api/po/${po.po_number}?download=1`}>Download PDF</a>
      <a className="btn" href={`/api/po/${po.po_number}`} target="_blank" rel="noreferrer">Preview</a>
    </div>
  );
}
