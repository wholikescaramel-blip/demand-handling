import { getSnapshot } from "@/lib/data";
import { Kpi, PoPill, fmtDateTime } from "@/components/ui";
import { NotConnected } from "@/components/NotConnected";
import { PoActions } from "@/components/PoActions";
import { generatePos, markReceived } from "../review/actions";

export const dynamic = "force-dynamic";

const inr = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ error?: string; created?: string; ok?: string }> }) {
  const { error, created, ok } = await searchParams;
  const snap = await getSnapshot();
  if (!snap) return <NotConnected />;
  const waiting = snap.decisions.filter((d) => d.po_status === "READY");
  const onOrder = snap.pos.filter((p) => !p.received_at);

  return (
    <>
      <h1>Purchase orders</h1>
      <p className="sub">
        Every approval creates one numbered PO. Download the PDF and send it to the vendor yourself. Nothing is created without Raghav or Deepa approving.
      </p>

      {error ? <div className="banner bad" role="alert">{error}</div> : null}
      {created !== undefined ? <div className="banner good" role="status">{created} purchase order(s) created.</div> : null}
      {ok ? <div className="banner good" role="status">{ok}</div> : null}

      <section className="grid kpis">
        <Kpi label="POs created" value={snap.pos.length} note="one per approval" />
        <Kpi label="On order" value={onOrder.length} note="not yet marked received; counts as stock on order" />
        <Kpi label="Approved, PO missing" value={waiting.length} note="only if creating a PO failed" />
      </section>

      {waiting.length ? (
        <section className="card" style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", gap: 16, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
            <h2 style={{ margin: 0 }}>Approved, but the PO was not created ({waiting.length})</h2>
            <form action={generatePos}><button className="btn primary" type="submit">Create the missing POs</button></form>
          </div>
          <div className="tablewrap">
            <table>
              <thead><tr><th>SKU</th><th className="num">Qty</th><th>Status</th><th>Approved by</th></tr></thead>
              <tbody>
                {waiting.map((l) => (
                  <tr key={`${l.run_id}-${l.sku}`}>
                    <td><strong>{l.sku}</strong><div className="small dim">{l.name}</div></td>
                    <td className="num">{l.final_qty}</td>
                    <td><PoPill status={l.po_status} /></td>
                    <td className="small">{l.reviewer}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <div className="reviewlist">
        {snap.pos.map((p) => (
          <section key={p.po_number} className="card">
            <div className="reviewhead">
              <div>
                <h2 style={{ margin: 0 }}>{p.po_number}</h2>
                <div className="dim">{p.vendor_name ?? p.vendor_key} · {fmtDateTime(p.created_at)} · approved by {p.created_by}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="bigqty">{p.total_qty} units</div>
                <div className="small dim">{p.total_amount != null ? `Rs ${inr(p.total_amount)} incl. tax` : "no rates on file"}</div>
              </div>
            </div>
            <p className="small" style={{ margin: "10px 0" }}>{p.lines.map((l) => `${l.sku} ${l.name ?? ""} × ${l.qty}`).join("  ·  ")}</p>
            <PoActions po={p} />
            <div style={{ marginTop: 10 }}>
              {p.received_at ? (
                <span className="pill ok">Received {fmtDateTime(p.received_at)}</span>
              ) : (
                <form action={markReceived}>
                  <input type="hidden" name="po_number" value={p.po_number} />
                  <button className="btn" type="submit">Mark received</button>
                </form>
              )}
            </div>
          </section>
        ))}
        {!snap.pos.length ? <section className="card"><p className="dim" style={{ margin: 0 }}>No purchase orders yet. Approve a recommendation on the Review tab and its PO appears here.</p></section> : null}
      </div>
    </>
  );
}
