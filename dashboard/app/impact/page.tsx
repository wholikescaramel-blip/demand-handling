import { getSnapshot } from "@/lib/data";
import { evaluateImpact, lakh, mondayOf, total } from "@/lib/impact";
import { DemoBanner, Kpi, fmtDateTime } from "@/components/ui";
import { LossChart, SavedChart } from "@/components/ImpactCharts";
import { saveImpactSettings, saveLossEntry } from "./actions";

export const dynamic = "force-dynamic";

const today = () => new Date().toISOString().slice(0, 10);
const pctText = (x: number | null) => (x === null ? "n/a" : `${Math.round(x * 100)}%`);

export default async function ImpactPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const { error, ok } = await searchParams;
  const snap = await getSnapshot();
  const { entries, settings } = snap.impact;
  const ev = evaluateImpact(entries, settings, today());
  const locked = snap.demo;
  const tone = ev.status === "on_target" ? "var(--ok-bg)" : ev.status === "improving" ? "var(--warn-bg)" : ev.status === "revert" ? "var(--bad-bg)" : "var(--na-bg)";
  const toneBorder = ev.status === "on_target" ? "var(--healthy)" : ev.status === "improving" ? "var(--warn)" : ev.status === "revert" ? "var(--bad)" : "var(--border)";
  const lakhIn = (rupees: number | null) => (rupees === null ? "" : String(rupees / 100000));

  return (
    <>
      <DemoBanner demo={snap.demo} />
      <h1>Impact</h1>
      <p className="sub">
        Are planning losses (stockouts plus overstock write-offs) lower than before the system? Add the weekly numbers and the graphs
        update. At day {ev.horizon}, Raghav or Deepa decide whether to keep the system or go back to manual planning.
      </p>

      {error ? <div className="banner" role="alert" style={{ background: "var(--bad-bg)", borderColor: "var(--bad)" }}>{error}</div> : null}
      {ok ? <div className="banner" role="status" style={{ background: "var(--ok-bg)", borderColor: "var(--healthy)" }}>{ok}</div> : null}

      <section className="card" style={{ background: tone, borderColor: toneBorder, marginBottom: 14 }}>
        <h2 style={{ marginBottom: 4 }}>
          {ev.phase === "decision" ? "Day-90 decision" : ev.phase === "tracking" ? "Reading so far (not final)" : "Not started"}
        </h2>
        <p style={{ margin: 0 }}>{ev.verdict}</p>
      </section>

      <section className="grid kpis" aria-label="Impact numbers">
        <Kpi label="Day" value={ev.phase === "not_started" ? "n/a" : `${ev.day} of ${ev.horizon}`} note={ev.goLive ? `Live since ${ev.goLive} · ${ev.daysLeft} days to the decision` : "Go-live date not set"} />
        <Kpi label="Avg weekly loss" value={ev.avgWeekly === null ? "n/a" : lakh(ev.avgWeekly)} note={`Before the system: ${lakh(ev.baselineWeekly)} a week`} />
        <Kpi label="Losses vs baseline" value={ev.reductionPct === null ? "n/a" : `${ev.reductionPct >= 0 ? "-" : "+"}${pctText(Math.abs(ev.reductionPct))}`} note={`Target -${pctText(settings.target_pct)} · stop below -${pctText(settings.kill_pct)}`} />
        <Kpi label="Saved so far" value={ev.savedTotal === null ? "n/a" : lakh(ev.savedTotal)} note={`${ev.weeks} week(s) logged`} />
      </section>

      <section className="grid two">
        <div className="card">
          <h2>Weekly losses vs the pre-AI baseline</h2>
          <LossChart data={ev.series} />
          <p className="small dim" style={{ marginBottom: 0 }}>Lower bars are better. Amounts in rupees lakh (L).</p>
        </div>
        <div className="card">
          <h2>Saved compared with the baseline, running total</h2>
          <SavedChart data={ev.series} />
          <p className="small dim" style={{ marginBottom: 0 }}>Above zero means the system is saving money; it grows with every entry.</p>
        </div>
      </section>

      <section className="grid two">
        <form action={saveLossEntry} className="card">
          <h2>Add or correct a week</h2>
          <p className="small dim" style={{ marginTop: 0 }}>
            From finance: lost sales on stock-outs, and write-offs on overstock, for one week. In <strong>rupees lakh</strong>, for example 1.25.
            Saving the same week again replaces it.
          </p>
          <div className="reviewcontrols" style={{ alignItems: "flex-start" }}>
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
          </div>
          <label className="small dim" style={{ display: "grid", gap: 4, marginTop: 10 }}>Note (optional)
            <input name="note" type="text" maxLength={300} placeholder="e.g. Diwali week, two distributors short" style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)" }} />
          </label>
          <div style={{ marginTop: 12 }}>
            <button className="btn primary" type="submit" disabled={locked}>Save week</button>
          </div>
        </form>

        <div className="card">
          <h2>Entries since go-live</h2>
          <div className="tablewrap">
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
                {!entries.length ? <tr><td colSpan={5} className="dim">Nothing entered yet.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <details className="card" style={{ marginBottom: 14 }}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>Baseline and go-live settings</summary>
        <form action={saveImpactSettings} style={{ marginTop: 12 }}>
          <p className="small dim" style={{ marginTop: 0 }}>
            The baseline is what planning errors cost per quarter before the system (the brief says Rs 28 to 34 lakh). The weekly baseline is the middle of that range
            divided by 13 weeks. Go-live defaults to the date of the first live run.
          </p>
          <div className="reviewcontrols" style={{ alignItems: "flex-start" }}>
            <label className="small dim">Go-live date
              <input name="go_live" type="date" defaultValue={settings.go_live ?? ""} />
            </label>
            <label className="small dim">Baseline per quarter, low (L)
              <input name="baseline_low" type="text" inputMode="decimal" defaultValue={lakhIn(settings.baseline_low)} />
            </label>
            <label className="small dim">high (L)
              <input name="baseline_high" type="text" inputMode="decimal" defaultValue={lakhIn(settings.baseline_high)} />
            </label>
            <label className="small dim">Perishable write-offs per quarter (L, optional)
              <input name="baseline_perishable" type="text" inputMode="decimal" defaultValue={lakhIn(settings.baseline_perishable_quarter)} />
            </label>
            <label className="small dim">Decision day
              <input name="horizon_days" type="number" min={14} max={365} defaultValue={settings.horizon_days} />
            </label>
          </div>
          <div style={{ marginTop: 12 }}>
            <button className="btn" type="submit" disabled={locked}>Save settings</button>
          </div>
        </form>
      </details>

      <section className="card">
        <h2>How the decision works</h2>
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          <li>A reading needs at least 4 weekly entries.</li>
          <li>At day {ev.horizon}, losses <strong>{pctText(settings.target_pct)} or more below baseline</strong>: keep the system.</li>
          <li>Between {pctText(settings.kill_pct)} and {pctText(settings.target_pct)} below: some improvement. Review the rules with Deepa before deciding.</li>
          <li>Less than {pctText(settings.kill_pct)} below, or higher: <strong>shift back to manual planning</strong>.</li>
          <li>If perishable write-offs rise above their baseline at any point, that breaches the guardrail even if the total looks better.</li>
        </ul>
        <p className="small dim" style={{ marginBottom: 0 }}>
          Last entry {entries.length ? fmtDateTime(`${entries[entries.length - 1].week_start}T00:00:00Z`) : "none yet"}. The numbers come from finance, because the sales and stock data have no prices.
        </p>
      </section>
    </>
  );
}
