import { getSnapshot } from "@/lib/data";
import { mailConfigured } from "@/lib/mail";
import { DemoBanner, Kpi, PoPill, fmtDateTime } from "@/components/ui";
import { generatePos, markReceived, sendPoEmail } from "../review/actions";

export const dynamic = "force-dynamic";

const inr = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ error?: string; created?: string; sent?: string }> }) {
  const { error, created, sent } = await searchParams;
  const snap = await getSnapshot();
  const waiting = snap.decisions.filter((d) => d.po_status === "READY");
  const onOrder = snap.pos.filter((p) => !p.received_at);
  const emailOn = mailConfigured();

  return (
    <>
      <DemoBanner demo={snap.demo} />
      <h1>Purchase orders</h1>
      <p className="sub">
        When Raghav has decided every line in a run, the approved lines are turned into numbered purchase orders, one per vendor. Open the PDF,
        download it, or email it to the vendor from here. Nothing is generated without an approval.
      </p>

      {error ? <div className="banner" role="alert" style={{ background: "var(--bad-bg)", borderColor: "var(--bad)" }}>{error}</div> : null}
      {created !== undefined ? (
        <div className="banner" role="status" style={{ background: "var(--ok-bg)", borderColor: "var(--healthy)" }}>{created} purchase order(s) generated.</div>
      ) : null}
      {sent ? <div className="banner" role="status" style={{ background: "var(--ok-bg)", borderColor: "var(--healthy)" }}>{sent} emailed.</div> : null}

      <section className="grid kpis">
        <Kpi label="POs generated" value={snap.pos.length} note="all time" />
        <Kpi label="On order" value={onOrder.length} note="not yet marked received; counts as stock on order" />
        <Kpi label="Emailed" value={snap.pos.filter((p) => p.sent_at).length} note={emailOn ? "sent from this page" : "email not set up; download instead"} />
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

      <div className="reviewlist">
        {snap.pos.map((p) => {
          const defaultTo = snap.vendorEmails?.[p.vendor_key] ?? p.vendor?.email ?? "";
          return (
            <section key={p.po_number} className="card">
              <div className="reviewhead">
                <div>
                  <h2 style={{ margin: 0 }}>{p.po_number}</h2>
                  <div className="dim">{p.vendor_name ?? p.vendor_key} · {fmtDateTime(p.created_at)} · approved by {p.created_by}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 20, fontWeight: 700 }}>{p.total_qty} units</div>
                  <div className="small dim">{p.total_amount != null ? `Rs ${inr(p.total_amount)} incl. tax` : "no rates on file"}</div>
                </div>
              </div>

              <p className="small" style={{ margin: "10px 0" }}>{p.lines.map((l) => `${l.sku} ${l.name ?? ""} × ${l.qty}`).join("  ·  ")}</p>

              <div className="reviewcontrols">
                <div className="btns">
                  <a className="btn primary" href={`/api/po/${p.po_number}?download=1`}>Download PDF</a>
                  <a className="btn" href={`/api/po/${p.po_number}`} target="_blank" rel="noreferrer">Preview</a>
                </div>
                <form action={sendPoEmail} className="reviewcontrols" style={{ margin: 0, flex: 1, minWidth: 280 }}>
                  <input type="hidden" name="po_number" value={p.po_number} />
                  <label className="small dim" style={{ flex: 1, minWidth: 200 }}>Email to
                    <input name="to" type="email" defaultValue={defaultTo} placeholder="vendor@example.com" required disabled={!emailOn || snap.demo} />
                  </label>
                  <button className="btn" type="submit" disabled={!emailOn || snap.demo} title={emailOn ? "" : "Email is not set up yet"}>Send by email</button>
                </form>
                {p.received_at ? (
                  <span className="pill ok">Received {fmtDateTime(p.received_at)}</span>
                ) : (
                  <form action={markReceived}>
                    <input type="hidden" name="po_number" value={p.po_number} />
                    <button className="btn" type="submit" disabled={snap.demo}>Mark received</button>
                  </form>
                )}
              </div>
              <div className="small dim" style={{ marginTop: 8 }}>
                {p.sent_at ? `Emailed to ${p.sent_to} on ${fmtDateTime(p.sent_at)}.` : "Not emailed yet."}
                {!emailOn && !p.sent_at ? " Email is not set up, so use Download PDF." : ""}
              </div>
            </section>
          );
        })}
        {!snap.pos.length ? <section className="card"><p className="dim" style={{ margin: 0 }}>No purchase orders yet.</p></section> : null}
      </div>
    </>
  );
}
