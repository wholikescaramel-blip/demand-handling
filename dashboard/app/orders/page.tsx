import { getSnapshot } from "@/lib/data";
import { DemoBanner, Kpi, PoPill, fmtDateTime } from "@/components/ui";
import { generatePos, markReceived } from "../review/actions";

export const dynamic = "force-dynamic";

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ error?: string; created?: string }> }) {
  const { error, created } = await searchParams;
  const snap = await getSnapshot();
  const waiting = snap.decisions.filter((d) => d.po_status === "READY");
  const onOrder = snap.pos.filter((p) => !p.received_at);
  const unsent = snap.pos.filter((p) => !p.delivered_at);

  return (
    <>
      <DemoBanner demo={snap.demo} />
      <h1>Purchase orders</h1>
      <p className="sub">
        When Raghav has decided every line in a run, the approved lines are turned into numbered PDF purchase orders, one per vendor. The
        Sheet then files each PDF in Drive and emails it to procurement. Nothing is generated without an approval.
      </p>

      {error ? <div className="banner" role="alert" style={{ background: "var(--bad-bg)", borderColor: "var(--bad)" }}>{error}</div> : null}
      {created !== undefined ? (
        <div className="banner" role="status" style={{ background: "var(--ok-bg)", borderColor: "var(--healthy)" }}>
          {created} purchase order(s) generated.
        </div>
      ) : null}

      <section className="grid kpis">
        <Kpi label="POs generated" value={snap.pos.length} note="all time" />
        <Kpi label="On order" value={onOrder.length} note="not yet marked received; counts as stock on order" />
        <Kpi label="Waiting to be filed" value={unsent.length} note="the Sheet files and emails these within the hour" />
        <Kpi label="Approved, no PO yet" value={waiting.length} note="generated when the run is fully decided" />
      </section>

      {waiting.length ? (
        <section className="card" style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", gap: 16, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
            <h2 style={{ margin: 0 }}>Approved, waiting for a PO ({waiting.length})</h2>
            <form action={generatePos}><button className="btn primary" type="submit" disabled={snap.demo}>Generate POs now</button></form>
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

      <section className="card">
        <h2>Generated purchase orders</h2>
        <div className="tablewrap">
          <table>
            <thead><tr><th>PO</th><th>Vendor</th><th>Lines</th><th className="num">Units</th><th>Created</th><th>Approved by</th><th>Filed + emailed</th><th>Goods</th></tr></thead>
            <tbody>
              {snap.pos.map((p) => (
                <tr key={p.po_number}>
                  <td><strong><a href={`/api/po/${p.po_number}`} target="_blank" rel="noreferrer">{p.po_number}</a></strong><div className="small dim">PDF</div></td>
                  <td>{p.vendor_name ?? p.vendor_key}</td>
                  <td className="small">{p.lines.map((l) => `${l.sku} × ${l.qty}`).join(", ")}</td>
                  <td className="num">{p.total_qty}</td>
                  <td className="small">{fmtDateTime(p.created_at)}</td>
                  <td className="small">{p.created_by}</td>
                  <td>{p.delivered_at ? <span className="pill ok">{fmtDateTime(p.delivered_at)}</span> : <span className="pill warn">Pending</span>}</td>
                  <td>
                    {p.received_at ? (
                      <span className="pill ok">Received {fmtDateTime(p.received_at)}</span>
                    ) : (
                      <form action={markReceived}>
                        <input type="hidden" name="po_number" value={p.po_number} />
                        <button className="btn" type="submit" disabled={snap.demo}>Mark received</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
              {!snap.pos.length ? <tr><td colSpan={8} className="dim">No purchase orders yet.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
