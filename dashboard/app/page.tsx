import { getSnapshot } from "@/lib/data";
import {
  ADOPTION_KILL, decisionStats, estimateCostInr, killChecks, runSeries, weeklyChangeRate,
} from "@/lib/metrics";
import { ActionPill, DecisionPill, DemoBanner, Kpi, KillChecks, fmtDateTime, pct } from "@/components/ui";
import { ChangeRateChart, RunsChart } from "@/components/Charts";
import { evaluateImpact } from "@/lib/impact";

export const dynamic = "force-dynamic";

export default async function Overview() {
  const snap = await getSnapshot();
  const run = snap.latestRun;
  const stats = decisionStats(snap.decisions);
  const weekly = weeklyChangeRate(snap.decisions);
  const impact = evaluateImpact(snap.impact.entries, snap.impact.settings, new Date().toISOString().slice(0, 10));
  const checks = killChecks(run, stats, weekly, impact);
  const awaiting = run?.mode === "LIVE" ? snap.recs.filter((r) => !r.decision).length : null;
  const perMillion = process.env.GEMINI_COST_PER_MILLION_TOKENS_INR ? Number(process.env.GEMINI_COST_PER_MILLION_TOKENS_INR) : null;
  const tokens = snap.runs.reduce((s, r) => s + r.gemini_tokens, 0);
  const cost = estimateCostInr(tokens, perMillion);

  return (
    <>
      <DemoBanner demo={snap.demo} />
      <h1>Overview</h1>
      <p className="sub">
        {run ? (
          <>
            Latest run {fmtDateTime(run.run_at)} · stock as of {run.as_of} ·{" "}
            <span className={`pill ${run.mode === "LIVE" ? "ok" : "neutral"}`}>{run.mode === "LIVE" ? "Live" : "Shadow mode"}</span>
            {run.festival ? <> · <span className="pill warn">Festival month</span></> : null}
          </>
        ) : (
          "No runs synced yet. Run the pipeline in the Sheet."
        )}
      </p>

      <section className="grid kpis" aria-label="Key numbers">
        <Kpi label="SKUs flagged" value={run ? `${run.flagged} of ${run.skus}` : "n/a"} note={run ? `${run.n_reorder} reorder · ${run.n_pause} pause · ${run.n_manual} manual` : undefined} />
        <Kpi label="Awaiting Raghav" value={awaiting === null ? "n/a" : <a href="/review" style={{ color: "inherit" }}>{awaiting}</a>} note={awaiting === null ? "Shadow mode: nothing sent to review" : "decisions due within 24h"} />
        <Kpi label="Changed or rejected" value={pct(stats.changedRate)} note={`Kill line ${pct(ADOPTION_KILL)} · ${stats.decided} decided`} />
        <Kpi label="Avg time to decide" value={stats.avgHours === null ? "n/a" : `${stats.avgHours.toFixed(1)} h`} note={stats.slaRate === null ? undefined : `${pct(stats.slaRate)} within 24h`} />
        <Kpi label="Gemini usage" value={`${(tokens / 1000).toFixed(1)}k tokens`} note={cost === null ? "Free tier: Rs 0" : `about Rs ${cost.toFixed(2)}`} />
      </section>

      {run?.summary ? (
        <section className="card" style={{ marginBottom: 14 }}>
          <h2>Run summary</h2>
          <p style={{ margin: 0 }}>{run.summary}</p>
          <p className="small dim" style={{ margin: "8px 0 0" }}>
            Reasons written by Gemini: {run.gemini_reasons ?? "n/a"}. Gemini only words numbers the rules engine computed.
            {run.notes ? <> Notes: {run.notes}</> : null}
          </p>
        </section>
      ) : null}

      <section className="grid two">
        <div className="card">
          <h2>What each run flagged</h2>
          <RunsChart data={runSeries(snap.runs)} />
        </div>
        <div className="card">
          <h2>Quantity changed or rejected, by week</h2>
          <ChangeRateChart data={weekly} kill={ADOPTION_KILL} />
        </div>
      </section>

      <section className="grid two">
        <div className="card">
          <h2>Guardrails</h2>
          <KillChecks checks={checks} />
        </div>
        <div className="card">
          <h2>Decisions so far</h2>
          <table>
            <tbody>
              <tr><td>Approved as recommended</td><td className="num">{stats.approve}</td></tr>
              <tr><td>Overridden (quantity changed)</td><td className="num">{stats.override}</td></tr>
              <tr><td>Rejected</td><td className="num">{stats.reject}</td></tr>
              <tr><td>Expired (not decided in time)</td><td className="num">{stats.expired}</td></tr>
            </tbody>
          </table>
          <p className="small dim" style={{ marginBottom: 0 }}>
            Every override and reject carries a reason. Those reasons document the 15-20% of calls that used to live only in Raghav&apos;s head.
          </p>
        </div>
      </section>

      <section className="card">
        <h2>Latest recommendations{run ? ` (${run.run_id})` : ""}</h2>
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Priority</th><th>SKU</th><th>Action</th><th className="num">Qty</th><th className="num">On hand</th>
                <th className="num">Cover (wks)</th><th className="num">Trend</th><th>Why</th><th>Decision</th>
              </tr>
            </thead>
            <tbody>
              {snap.recs.map((r) => (
                <tr key={r.sku}>
                  <td className="num">{r.priority}</td>
                  <td>
                    <strong>{r.sku}</strong>
                    <div className="small dim">{r.name}{r.perishable ? " · perishable" : ""}</div>
                  </td>
                  <td><ActionPill action={r.action} /></td>
                  <td className="num">{r.rec_qty ?? "—"}</td>
                  <td className="num">{r.on_hand}{r.open_po ? <span className="dim"> +{r.open_po} on order</span> : null}</td>
                  <td className="num">{r.cover_weeks ?? "—"}</td>
                  <td className="num">{r.trend_pct === null ? "—" : `${r.trend_pct > 0 ? "+" : ""}${r.trend_pct}%`}</td>
                  <td className="reason">
                    {r.reason}
                    <div className="small dim">{r.reason_source === "gemini" ? "Written by Gemini" : "Template text"}{r.data_notes ? ` · ${r.data_notes}` : ""}</div>
                  </td>
                  <td>
                    <DecisionPill decision={run?.mode === "LIVE" ? r.decision : null} />
                    {r.decision === "Override" && r.final_qty !== null ? <div className="small dim">Final {r.final_qty}</div> : null}
                    {r.change_reason ? <div className="small dim">{r.change_reason}</div> : null}
                  </td>
                </tr>
              ))}
              {!snap.recs.length ? <tr><td colSpan={9} className="dim">Nothing flagged in the latest run.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
