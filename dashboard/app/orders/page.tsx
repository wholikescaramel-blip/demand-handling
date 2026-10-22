import { getSnapshot } from "@/lib/data";
import { zohoCfg } from "@/lib/zoho";
import { DemoBanner, Kpi, PoPill, fmtDateTime } from "@/components/ui";
import { createPos } from "../review/actions";

export const dynamic = "force-dynamic";

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ error?: string; created?: string; failed?: string }> }) {
  const { error, created, failed } = await searchParams;
  const snap = await getSnapshot();
  const cfg = zohoCfg();
  const lines = snap.decisions.filter((d) => d.po_status && d.po_status !== "NONE");
  const byPo = new Map<string, typeof lines>();
  for (const l of lines.filter((x) => x.po_status === "CREATED")) {
    const k = l.po_number ?? "?";
    byPo.set(k, [...(byPo.get(k) ?? []), l]);
  }
  const open = lines.filter((l) => l.po_status === "READY" || l.po_status === "FAILED" || l.po_status === "PENDING");
  const failedLines = lines.filter((l) => l.po_status === "FAILED");

  return (
    <>
      <DemoBanner demo={snap.demo} />
      <h1>Purchase orders</h1>
      <p className="sub">
        Approved recommendations become Zoho purchase orders, one per vendor, created as <strong>{cfg?.poStatus ?? "draft"}</strong>.
        Nothing is created without an approval, and procurement still finalises the PO in Zoho.
      </p>

      {error ? <div className="banner" role="alert" style={{ background: "var(--bad-bg)", borderColor: "var(--bad)" }}>{error}</div> : null}
      {created !== undefined ? (
        <div className="banner" role="status" style={{ background: "var(--ok-bg)", borderColor: "var(--healthy)" }}>
          {created} purchase order(s) created{Number(failed) ? `, ${failed} problem(s) below` : ""}.
        </div>
      ) : null}

      <section className="grid kpis">
        <Kpi label="Zoho connection" value={cfg ? "Configured" : "Not set up"} note={cfg ? `Data centre .${cfg.dc} · POs as ${cfg.poStatus}` : "Add the ZOHO_* variables (see README)"} />
        <Kpi label="POs created" value={byPo.size} note="all time, from this tool" />
        <Kpi label="Waiting to be created" value={open.length} note={`${failedLines.length} failed`} />
      </section>

      {open.length ? (
        <section className="card" style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", gap: 16, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
            <h2 style={{ margin: 0 }}>Waiting for Zoho ({open.length})</h2>
            <form action={createPos}><button className="btn primary" type="submit" disabled={snap.demo}>Create / retry POs in Zoho</button></form>
          </div>
          <div className="tablewrap">
            <table>
              <thead><tr><th>SKU</th><th className="num">Qty</th><th>Status</th><th>Detail</th></tr></thead>
              <tbody>
                {open.map((l) => (
                  <tr key={`${l.run_id}-${l.sku}`}>
                    <td><strong>{l.sku}</strong><div className="small dim">{l.name}</div></td>
                    <td className="num">{l.final_qty}</td>
                    <td><PoPill status={l.po_status} /></td>
                    <td className="reason small">{l.po_error ?? <span className="dim">Approved by {l.reviewer}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="card">
        <h2>Created in Zoho</h2>
        <div className="tablewrap">
          <table>
            <thead><tr><th>PO number</th><th>Vendor</th><th>Lines</th><th>Created</th><th>Approved by</th></tr></thead>
            <tbody>
              {[...byPo.entries()].map(([po, ls]) => (
                <tr key={po}>
                  <td><strong>{po}</strong></td>
                  <td>{ls[0].po_vendor}</td>
                  <td>{ls.map((l) => `${l.sku} × ${l.final_qty}`).join(", ")}</td>
                  <td className="small">{fmtDateTime(ls[0].po_created_at ?? null)}</td>
                  <td className="small">{[...new Set(ls.map((l) => l.reviewer))].join(", ")}</td>
                </tr>
              ))}
              {!byPo.size ? <tr><td colSpan={5} className="dim">No purchase orders yet.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
