import { getSnapshot } from "@/lib/data";
import { ADOPTION_KILL, decisionStats, killChecks, perRuleStats, runSeries, weeklyChangeRate } from "@/lib/metrics";
import { evaluateImpact, lakh, mondayOf, total } from "@/lib/impact";
import { loadRules } from "@/lib/planning";
import { RULE_DEFS, type RuleGroup } from "@/lib/rules";
import { Kpi, KillChecks, fmtDateTime, pct } from "@/components/ui";
import { ChangeRateChart, RunsChart } from "@/components/Charts";
import { LossChart, SavedChart } from "@/components/ImpactCharts";
import { NotConnected } from "@/components/NotConnected";
import { runPlanningNow } from "./review/actions";
import { saveLossEntry } from "./impact/actions";

export const dynamic = "force-dynamic";

const today = () => new Date().toISOString().slice(0, 10);
const pctText = (x: number | null) => (x === null ? "n/a" : `${Math.round(x * 100)}%`);
const GROUPS: { id: RuleGroup; title: string }[] = [
  { id: "rules", title: "Raghav's rules" },
  { id: "review", title: "Review and feedback" },
  { id: "data", title: "Data checks" },
];

export default async function Overview({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const { error, ok } = await searchParams;
  const snap = await getSnapshot();
  if (!snap) return <NotConnected />;
  const rules = await loadRules();
  const run = snap.latestRun;
  const stats = decisionStats(snap.decisions);
  const weekly = weeklyChangeRate(snap.decisions);
  const { entries, settings } = snap.impact;
  const ev = evaluateImpact(entries, settings, today());
  const checks = killChecks(run, stats, weekly, ev);
  const awaiting = run?.mode === "LIVE" ? snap.recs.filter((r) => !r.decision).length : null;
  const ruleStats = perRuleStats(snap.decisions);
  const openReviews = snap.ruleReviews.filter((r) => r.status === "OPEN");
  const show = (key: keyof typeof rules, kind: string) => {
    const v = rules[key];
    return kind === "pct" ? `${Math.round(Number(v) * 10000) / 100}%` : kind === "bool" ? (v ? "On" : "Off") : String(v);
  };
  const tone = ev.status === "on_target" ? "ok" : ev.status === "improving" ? "warn" : ev.status === "revert" ? "bad" : "";

  return (
    <>
      <div className="head">
        <div>
          <h1>Overview</h1>
          <p className="sub">
            {run ? (
              <>
                Latest run {fmtDateTime(run.run_at)} · stock as of {run.as_of}{run.festival ? " · festival month" : ""}
                {run.mode !== "LIVE" ? " · shadow mode" : ""}
              </>
            ) : "No planning run yet."}
          </p>
        </div>
        <form action={runPlanningNow}><button className="btn" type="submit">Run planning now</button></form>
      </div>

      {error ? <div className="banner bad" role="alert">{error}</div> : null}
      {ok ? <div className="banner good" role="status">{ok}</div> : null}

      <section className="grid kpis" aria-label="Key numbers">
        <Kpi label="SKUs flagged" value={run ? `${run.flagged} of ${run.skus}` : "n/a"} note={run ? `${run.n_reorder} reorder · ${run.n_pause} pause · ${run.n_manual} manual` : undefined} />
        <Kpi label="Awaiting review" value={awaiting === null ? "n/a" : <a href="/review" style={{ color: "inherit" }}>{awaiting}</a>} note={awaiting === null ? "Shadow mode: nothing sent to review" : "Raghav or Deepa to decide"} />
        <Kpi label="Changed or rejected" value={pct(stats.changedRate)} note={`Line ${pct(ADOPTION_KILL)} · ${stats.decided} decided`} />
        <Kpi label="Avg time to decide" value={stats.avgHours === null ? "n/a" : `${stats.avgHours.toFixed(1)} h`} note={stats.slaRate === null ? undefined : `${pct(stats.slaRate)} within 24h`} />
      </section>

      {run?.summary ? (
        <section className="card">
          <h2>Latest run</h2>
          <p style={{ margin: 0 }}>{run.summary}</p>
          {run.notes ? <p className="small dim" style={{ margin: "8px 0 0" }}>{run.notes}</p> : null}
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
              <tr><td>Approved with a changed quantity</td><td className="num">{stats.override}</td></tr>
              <tr><td>Rejected</td><td className="num">{stats.reject}</td></tr>
              <tr><td>Expired (not decided in time)</td><td className="num">{stats.expired}</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <h2 className="sectiontitle" id="impact">Impact</h2>
      <section className={`card verdict ${tone}`}>
        <h3>{ev.phase === "decision" ? "Day-90 decision" : ev.phase === "tracking" ? "Reading so far (not final)" : "Not started"}</h3>
        <p style={{ margin: 0 }}>{ev.verdict}</p>
      </section>

      <section className="grid kpis" aria-label="Impact numbers">
        <Kpi label="Day" value={ev.phase === "not_started" ? "n/a" : `${ev.day} of ${ev.horizon}`} note={ev.goLive ? `Live since ${ev.goLive}` : "Starts with the first live run"} />
        <Kpi label="Avg weekly loss" value={ev.avgWeekly === null ? "n/a" : lakh(ev.avgWeekly)} note={`Before the system: ${lakh(ev.baselineWeekly)} a week`} />
        <Kpi label="Losses vs baseline" value={ev.reductionPct === null ? "n/a" : `${ev.reductionPct >= 0 ? "-" : "+"}${pctText(Math.abs(ev.reductionPct))}`} note={`Target -${pctText(settings.target_pct)} · stop below -${pctText(settings.kill_pct)}`} />
        <Kpi label="Saved so far" value={ev.savedTotal === null ? "n/a" : lakh(ev.savedTotal)} note={`${ev.weeks} week(s) logged`} />
      </section>

      <section className="grid two">
        <div className="card">
          <h2>Weekly losses vs the pre-AI baseline</h2>
          <LossChart data={ev.series} />
        </div>
        <div className="card">
          <h2>Saved vs baseline, running total</h2>
          <SavedChart data={ev.series} />
        </div>
      </section>

      <details className="card">
        <summary>Add or correct a week of losses ({entries.length} logged)</summary>
        <form action={saveLossEntry} style={{ marginTop: 12 }}>
          <p className="small dim" style={{ marginTop: 0 }}>
            From finance, for one week, in <strong>rupees lakh</strong> (for example 1.25). Saving the same week again replaces it.
          </p>
          <div className="fields">
            <label className="small dim">A date in the week
              <input name="week" type="date" defaultValue={mondayOf(today())} max={today()} required />
            </label>
            <label className="small dim">Stockout losses (L)
              <input name="stockout" type="text" inputMode="decimal" placeholder="1.25" />
            </label>
            <label className="small dim">Overstock write-offs (L)
              <input name="overstock" type="text" inputMode="decimal" placeholder="0.80" />
            </label>
            <label className="small dim">of which perishable (L)
              <input name="perishable" type="text" inputMode="decimal" placeholder="0.30" />
            </label>
            <label className="small dim grow">Note (optional)
              <input name="note" type="text" maxLength={300} />
            </label>
          </div>
          <div style={{ marginTop: 12 }}><button className="btn primary" type="submit">Save week</button></div>
        </form>
        {entries.length ? (
          <div className="tablewrap" style={{ marginTop: 14 }}>
            <table>
              <thead><tr><th>Week of</th><th className="num">Stockout</th><th className="num">Overstock</th><th className="num">Total</th><th>Note</th></tr></thead>
              <tbody>
                {entries.slice().reverse().map((e) => (
                  <tr key={e.week_start}>
                    <td className="small">{e.week_start}</td>
                    <td className="num">{(e.stockout_loss / 100000).toFixed(2)}</td>
                    <td className="num">{(e.overstock_writeoff / 100000).toFixed(2)}</td>
                    <td className="num"><strong>{(total(e) / 100000).toFixed(2)}</strong></td>
                    <td className="small">{e.note}{e.entered_by ? <span className="dim"> · {e.entered_by}</span> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </details>

      <details className="card">
        <summary>Rules and thresholds in use{openReviews.length ? ` · ${openReviews.length} waiting for a second look` : ""}</summary>
        <p className="small dim" style={{ marginTop: 10 }}>
          Read only. These live in the Neon <code>rules</code> table; change a value there and the next planning run uses it.
        </p>
        {GROUPS.map((g) => (
          <div key={g.id} style={{ marginBottom: 12 }}>
            <h3>{g.title}</h3>
            <table>
              <tbody>
                {RULE_DEFS.filter((d) => d.group === g.id).map((d) => (
                  <tr key={d.key}>
                    <td>{d.label}<div className="small dim">{d.help}</div></td>
                    <td className="num"><strong>{show(d.key, d.kind)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

        <h3>How often each rule is changed or rejected</h3>
        <table>
          <thead><tr><th>Rule flag</th><th className="num">Decisions</th><th className="num">Changed or rejected</th><th className="num">Rate</th></tr></thead>
          <tbody>
            {ruleStats.map((r) => (
              <tr key={r.rule}>
                <td>{r.rule}</td><td className="num">{r.total}</td><td className="num">{r.changed}</td>
                <td className="num"><span className={`pill ${r.rate > ADOPTION_KILL ? "breach" : "ok"}`}>{pct(r.rate)}</span></td>
              </tr>
            ))}
            {!ruleStats.length ? <tr><td colSpan={4} className="dim">No decisions yet.</td></tr> : null}
          </tbody>
        </table>

        {openReviews.length ? (
          <>
            <h3 style={{ marginTop: 14 }}>Waiting for a second look</h3>
            {openReviews.map((r) => (
              <p key={r.id} style={{ margin: "6px 0" }}>
                <strong>{r.rule}</strong> <span className="pill warn">{r.changed} of {r.total} changed or rejected ({r.rate})</span>
                <span className="small dim"> opened {fmtDateTime(r.opened_at)}</span>
                {r.proposal ? <><br /><span className="small">{r.proposal}</span></> : null}
              </p>
            ))}
          </>
        ) : null}
      </details>
    </>
  );
}
