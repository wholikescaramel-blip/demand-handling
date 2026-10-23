import { getSnapshot } from "@/lib/data";
import { ActionPill, DecisionPill, PoPill, fmtDateTime } from "@/components/ui";
import { DecisionForm } from "@/components/DecisionForm";
import { PoActions } from "@/components/PoActions";
import { NotConnected } from "@/components/NotConnected";
import { loadStock } from "@/lib/planning";
import { createPoForLine, decide, runPlanningNow } from "./actions";

export const dynamic = "force-dynamic";

const FLAG_LABEL: Record<string, string> = {
  STOCKOUT_RISK: "Stockout risk",
  OVERSTOCK_RISK: "Overstock risk",
  HIGH_DEMAND: "High demand",
  SHORT_HISTORY: "New SKU, short history",
  NO_INVENTORY: "No stock record",
  NO_SALES: "No recent sales",
};

function recommendationText(action: string, qty: number | null): string {
  if (action === "REORDER") return `Order ${qty}`;
  if (action === "PAUSE") return "Pause the next order";
  return "Needs your call";
}

export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string; sku?: string }> }) {
  const { error, ok, sku: errSku } = await searchParams;
  const snap = await getSnapshot();
  if (!snap) return <NotConnected />;
  const run = snap.latestRun;
  const live = run?.mode === "LIVE";
  const pending = live ? snap.recs.filter((r) => !r.decision) : [];
  const decided = live ? snap.recs.filter((r) => r.decision) : [];
  // SKUs the rules cannot judge (new, or no stock/sales data) that are not in the latest run yet, e.g. after stock was edited in Neon
  const inRun = new Set(snap.recs.map((r) => r.sku));
  const stock = await loadStock();
  const waitingForRun = stock.ok ? stock.rows.filter((r) => r.action === "MANUAL_REVIEW" && (r.status === "NEW" || r.status === "NO_DATA") && !inRun.has(r.sku)) : [];
  const poBy = new Map(snap.pos.map((p) => [p.po_number, p]));

  return (
    <>
      <h1>Review</h1>
      <p className="sub">
        {run ? (
          <>Run {run.run_id} · stock as of {run.as_of} · {live ? (run.review_due_at ? `decide by ${fmtDateTime(run.review_due_at)}` : "waiting for decisions") : "shadow mode: nothing to decide"}</>
        ) : (
          "No planning run yet. Press Run planning now on the Overview tab."
        )}
      </p>

      {error ? <div className="banner bad" role="alert">{error}</div> : null}
      {ok ? <div className="banner good" role="status">{ok}</div> : null}

      {waitingForRun.length ? (
        <section className="card" style={{ borderLeft: "4px solid var(--manual)" }}>
          <div className="head">
            <div>
              <h2>Needs manual info ({waitingForRun.length})</h2>
              <p className="small dim" style={{ margin: 0 }}>
                The rules have no data to judge {waitingForRun.length === 1 ? "this SKU" : "these SKUs"}: {waitingForRun.map((r) => `${r.sku} (${r.status === "NEW" ? "new, short history" : "no stock or sales data"})`).join(", ")}.
                Run planning and {waitingForRun.length === 1 ? "it appears" : "they appear"} below as a manual card where a person enters the quantity and the reason.
              </p>
            </div>
            <form action={runPlanningNow}><button className="btn primary" type="submit">Run planning now</button></form>
          </div>
        </section>
      ) : null}

      {run && !live ? (
        <section className="card">
          <p style={{ margin: 0 }}>
            This run was made in <strong>shadow mode</strong>, so it was logged but not sent for review. Set SHADOW_MODE to false in the Neon rules table, then run planning again.
          </p>
        </section>
      ) : null}

      {live ? (
        <section style={{ marginBottom: 18 }}>
          <h2 className="sectiontitle">Waiting for your decision ({pending.length})</h2>
          <p className="small dim" style={{ marginTop: -4 }}>
            The rules only recommend. Nothing is ordered until Raghav or Deepa decides. Approve orders the recommended quantity, Edit lets you change it (with a reason), Reject orders nothing (with a reason).
          </p>
          {!pending.length ? <div className="card"><p className="dim" style={{ margin: 0 }}>Nothing waiting. Everything in this run has a decision.</p></div> : null}
          <div className="reviewlist">
            {pending.map((r) => (
              <article key={r.sku} className={`reviewitem${errSku === r.sku ? " haserr" : ""}`}>
                <div className="reviewhead">
                  <div>
                    <strong>{r.sku}</strong> <span className="dim">{r.name}</span>
                    {r.perishable ? <span className="pill neutral" style={{ marginLeft: 8 }}>perishable</span> : null}
                    <div className="small dim">Vendor: {r.distributor_name ?? r.distributor_id ?? "unknown"} · priority {r.priority}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <ActionPill action={r.action} />
                    <div className="bigqty">{recommendationText(r.action, r.rec_qty)}</div>
                    <div className="small dim">recommended by the rules</div>
                  </div>
                </div>

                <dl className="metrics">
                  <div><dt>On hand</dt><dd>{r.on_hand}{r.open_po ? <span className="dim"> +{r.open_po} on order</span> : null}</dd></div>
                  <div><dt>Weeks of cover</dt><dd>{r.cover_weeks ?? "n/a"}</dd></div>
                  <div><dt>Last 4 weeks vs 12-week avg</dt><dd>{r.trend_pct === null ? "n/a" : `${r.trend_pct > 0 ? "+" : ""}${r.trend_pct}%`}</dd></div>
                  <div><dt>Triggered by</dt><dd>{(r.flags ?? "").split(" + ").filter(Boolean).map((f) => FLAG_LABEL[f] ?? f).join(", ") || "n/a"}</dd></div>
                </dl>
                <p style={{ margin: "8px 0 0" }}>{r.reason}</p>
                <div className="small dim">{r.reason_source === "gemini" ? "Reason worded by Gemini" : "Standard reason text"}{r.data_notes ? ` · ${r.data_notes}` : ""}</div>

                <DecisionForm action={decide} runId={r.run_id} sku={r.sku} recQty={r.rec_qty} kind={r.action as "REORDER" | "PAUSE" | "MANUAL_REVIEW"} />
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {decided.length ? (
        <section>
          <h2 className="sectiontitle">Decided ({decided.length})</h2>
          <div className="reviewlist">
            {decided.map((r) => {
              const po = r.po_number ? poBy.get(r.po_number) : undefined;
              return (
                <article key={r.sku} className="reviewitem done">
                  <div className="reviewhead">
                    <div>
                      <strong>{r.sku}</strong> <span className="dim">{r.name}</span>
                      <div className="small dim">Vendor: {r.distributor_name ?? r.distributor_id ?? "unknown"} · recommended: {recommendationText(r.action, r.rec_qty)}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <DecisionPill decision={r.decision} />
                      <div className="bigqty">{r.decision === "Reject" ? "Not ordered" : r.final_qty ? `Ordered ${r.final_qty}` : "No order"}</div>
                    </div>
                  </div>
                  {r.change_reason ? <p className="small" style={{ margin: "6px 0 0" }}>Reason: {r.change_reason}</p> : null}
                  {po ? (
                    <div style={{ marginTop: 10 }}>
                      <div style={{ fontWeight: 700, marginBottom: 6 }}>Purchase order {po.po_number}</div>
                      <PoActions po={po} />
                    </div>
                  ) : r.po_status === "READY" ? (
                    <form action={createPoForLine} style={{ marginTop: 10 }}>
                      <input type="hidden" name="run_id" value={r.run_id} />
                      <input type="hidden" name="sku" value={r.sku} />
                      <PoPill status="READY" /> <button className="btn primary" type="submit">Create PO</button>
                    </form>
                  ) : null}
                </article>
              );
            })}
          </div>
        </section>
      ) : null}
    
      {snap.decisions.length ? (
        <details className="card" style={{ marginTop: 18 }}>
          <summary>Full decision history ({snap.decisions.length})</summary>
          <div className="tablewrap" style={{ marginTop: 10 }}>
            <table>
              <thead><tr><th>When</th><th>SKU</th><th>Rules said</th><th>Decision</th><th className="num">Qty</th><th>Reason</th><th>By</th></tr></thead>
              <tbody>
                {snap.decisions.map((d) => (
                  <tr key={`${d.run_id}-${d.sku}-${d.decided_at}`}>
                    <td className="small">{fmtDateTime(d.decided_at)}</td>
                    <td><strong>{d.sku}</strong><div className="small dim">{d.name}</div></td>
                    <td className="small">{d.action ?? "—"}{d.rec_qty != null ? ` ${d.rec_qty}` : ""}</td>
                    <td><DecisionPill decision={d.decision} /></td>
                    <td className="num">{d.final_qty ?? "—"}</td>
                    <td className="small">{d.reason}</td>
                    <td className="small">{d.reviewer}{d.po_number ? <div className="dim">{d.po_number}</div> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
    </>
  );
}
