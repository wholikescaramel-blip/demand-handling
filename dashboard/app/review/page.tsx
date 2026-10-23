import { getSnapshot } from "@/lib/data";
import { mailConfigured } from "@/lib/mail";
import { ActionPill, DecisionPill, DemoBanner, PoPill, fmtDateTime } from "@/components/ui";
import { DecisionForm } from "@/components/DecisionForm";
import { PoActions } from "@/components/PoActions";
import { createPoForLine, decide, resetPractice } from "./actions";

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
  const run = snap.latestRun;
  const live = run?.mode === "LIVE";
  const pending = live ? snap.recs.filter((r) => !r.decision) : [];
  const decided = live ? snap.recs.filter((r) => r.decision) : [];
  const emailOn = mailConfigured();
  const poBy = new Map(snap.pos.map((p) => [p.po_number, p]));

  return (
    <>
      <DemoBanner demo={snap.demo} />
      <h1>Review</h1>
      <p className="sub">
        {run ? (
          <>Run {run.run_id} · stock as of {run.as_of} · {live ? (run.review_due_at ? `decide by ${fmtDateTime(run.review_due_at)}` : "waiting for your decisions") : "shadow mode: nothing to decide"}</>
        ) : (
          "No run yet."
        )}
      </p>

      {error ? <div className="banner bad" role="alert">{error}</div> : null}
      {ok ? <div className="banner good" role="status">{ok}</div> : null}

      {run && !live ? (
        <section className="card">
          <p style={{ margin: 0 }}>
            This run was made in <strong>shadow mode</strong>, so it was logged but not sent for review. When you are ready to go live, set
            SHADOW_MODE to FALSE in the Rules_Config tab of the Sheet.
          </p>
        </section>
      ) : null}

      {live ? (
        <section style={{ marginBottom: 18 }}>
          <h2 className="sectiontitle">Waiting for your decision ({pending.length})</h2>
          <p className="small dim" style={{ marginTop: -4 }}>
            The rules only recommend. Nothing is ordered until you press Approve. The quantity box starts at the recommendation; change it if
            you know better. Rejecting needs a reason.
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
                <div className="small dim">{r.reason_source === "gemini" ? "Reason written by Gemini" : "Standard reason text"}{r.data_notes ? ` · ${r.data_notes}` : ""}</div>

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
                      <PoActions po={po} emailOn={emailOn} canEmail={!snap.demo} from="review" defaultTo={snap.vendorEmails?.[po.vendor_key] ?? po.vendor?.email ?? ""} />
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

      {snap.demo ? (
        <form action={resetPractice} style={{ marginTop: 18 }}>
          <button className="btn" type="submit">Clear my practice decisions</button>
        </form>
      ) : null}
    </>
  );
}
