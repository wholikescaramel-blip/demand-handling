import { getSnapshot } from "@/lib/data";
import { groupByVendor } from "@/lib/po";
import { zohoCfg } from "@/lib/zoho";
import { ActionPill, DecisionPill, DemoBanner, PoPill, fmtDateTime } from "@/components/ui";
import { createPos, decide } from "./actions";

export const dynamic = "force-dynamic";

export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string; sku?: string }> }) {
  const { error, ok, sku: errSku } = await searchParams;
  const snap = await getSnapshot();
  const run = snap.latestRun;
  const live = run?.mode === "LIVE";
  const pending = live ? snap.recs.filter((r) => !r.decision) : [];
  const decided = live ? snap.recs.filter((r) => r.decision) : [];
  const ready = decided.filter((r) => r.po_status === "READY" || r.po_status === "FAILED");
  const vendorCount = groupByVendor(
    ready.map((r) => ({ run_id: r.run_id, sku: r.sku, name: r.name, qty: r.final_qty ?? 0, vendor_key: r.distributor_id ?? "UNKNOWN", vendor_name: r.distributor_name ?? null })),
  ).length;
  const zoho = Boolean(zohoCfg());
  const locked = snap.demo;

  return (
    <>
      <DemoBanner demo={snap.demo} />
      <h1>Review</h1>
      <p className="sub">
        {run ? (
          <>
            Run {run.run_id} · stock as of {run.as_of} · {live ? (run.review_due_at ? "decide by " + fmtDateTime(run.review_due_at) : "awaiting decisions") : "shadow mode: nothing to decide"}
          </>
        ) : (
          "No run yet."
        )}
      </p>

      {error ? <div className="banner" role="alert" style={{ background: "var(--bad-bg)", borderColor: "var(--bad)" }}>{error}</div> : null}
      {ok ? <div className="banner" role="status" style={{ background: "var(--ok-bg)", borderColor: "var(--healthy)" }}>{ok}</div> : null}

      {run && !live ? (
        <section className="card">
          <p style={{ margin: 0 }}>
            This run was made in <strong>shadow mode</strong>, so it was logged but not sent for review. When you are ready to go live, set
            SHADOW_MODE to FALSE in the Rules_Config tab of the Sheet.
          </p>
        </section>
      ) : null}

      {live ? (
        <section className="card" style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", justifyContent: "space-between" }}>
            <div>
              <h2 style={{ marginBottom: 2 }}>Approved, ready for Zoho</h2>
              <span className="small dim">
                {ready.length} line(s) across {vendorCount} vendor(s). One purchase order is created per vendor. {zoho ? "" : "Zoho is not configured yet."}
              </span>
            </div>
            <form action={createPos}>
              <button className="btn primary" type="submit" disabled={locked || !ready.length}>
                Create POs in Zoho{ready.length ? ` (${vendorCount})` : ""}
              </button>
            </form>
          </div>
        </section>
      ) : null}

      {live ? (
        <section className="card" style={{ marginBottom: 14 }}>
          <h2>Waiting for your decision ({pending.length})</h2>
          {!pending.length ? <p className="dim" style={{ margin: 0 }}>Nothing waiting. Everything in this run has a decision.</p> : null}
          <div className="reviewlist">
            {pending.map((r) => (
              <form key={r.sku} action={decide} className={`reviewitem${errSku === r.sku ? " haserr" : ""}`}>
                <input type="hidden" name="run_id" value={r.run_id} />
                <input type="hidden" name="sku" value={r.sku} />
                <div className="reviewhead">
                  <div>
                    <strong>{r.sku}</strong> <span className="dim">{r.name}</span>{r.perishable ? <span className="pill neutral" style={{ marginLeft: 8 }}>perishable</span> : null}
                    <div className="small dim">Vendor: {r.distributor_name ?? r.distributor_id ?? "unknown"} · priority {r.priority}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <ActionPill action={r.action} />
                    <div style={{ fontSize: 20, fontWeight: 700 }}>{r.action === "MANUAL_REVIEW" ? "Your call" : r.action === "PAUSE" ? "Pause order" : `Order ${r.rec_qty}`}</div>
                  </div>
                </div>
                <p style={{ margin: "6px 0" }}>{r.reason}</p>
                <div className="small dim">
                  On hand {r.on_hand}{r.open_po ? ` (+${r.open_po} on order)` : ""} · cover {r.cover_weeks ?? "n/a"} wks · trend{" "}
                  {r.trend_pct === null ? "n/a" : `${r.trend_pct > 0 ? "+" : ""}${r.trend_pct}%`} ·{" "}
                  {r.reason_source === "gemini" ? "reason by Gemini" : "template reason"}{r.data_notes ? ` · ${r.data_notes}` : ""}
                </div>
                <div className="reviewcontrols">
                  <label className="small dim">Qty if overriding
                    <input name="override_qty" type="number" min={0} step={1} inputMode="numeric" placeholder={r.rec_qty?.toString() ?? ""} />
                  </label>
                  <label className="small dim" style={{ flex: 1, minWidth: 200 }}>Reason (needed to override or reject)
                    <input name="reason" type="text" maxLength={300} placeholder="e.g. distributor scheme starting Monday" />
                  </label>
                  <div className="btns">
                    <button className="btn ok" type="submit" name="decision" value="Approve" disabled={locked || r.action === "MANUAL_REVIEW"}>Approve</button>
                    <button className="btn warn" type="submit" name="decision" value="Override" disabled={locked}>Override</button>
                    <button className="btn bad" type="submit" name="decision" value="Reject" disabled={locked}>Reject</button>
                  </div>
                </div>
              </form>
            ))}
          </div>
        </section>
      ) : null}

      {decided.length ? (
        <section className="card">
          <h2>Decided in this run ({decided.length})</h2>
          <div className="tablewrap">
            <table>
              <thead><tr><th>SKU</th><th>Recommended</th><th>Decision</th><th className="num">Final qty</th><th>Why</th><th>Purchase order</th></tr></thead>
              <tbody>
                {decided.map((r) => (
                  <tr key={r.sku}>
                    <td><strong>{r.sku}</strong><div className="small dim">{r.name}</div></td>
                    <td><ActionPill action={r.action} /><div className="small dim">qty {r.rec_qty ?? "—"}</div></td>
                    <td><DecisionPill decision={r.decision} /></td>
                    <td className="num">{r.final_qty ?? "—"}</td>
                    <td className="reason">{r.change_reason ?? <span className="dim">—</span>}</td>
                    <td><PoPill status={r.po_status} />{r.po_number ? <div className="small dim">{r.po_number}</div> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}
