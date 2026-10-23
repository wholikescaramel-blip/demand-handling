import { getSnapshot } from "@/lib/data";
import { ADOPTION_KILL, perRuleStats } from "@/lib/metrics";
import { loadRules } from "@/lib/planning";
import { RULE_DEFS, type RuleGroup, type Rules } from "@/lib/rules";
import { fmtDateTime, pct } from "@/components/ui";
import { NotConnected } from "@/components/NotConnected";
import { geminiConfigured } from "@/lib/gemini";
import { askProposal, closeReview, resetRules, saveRules } from "./actions";

export const dynamic = "force-dynamic";

const GROUPS: { id: RuleGroup; title: string; blurb: string }[] = [
  { id: "rules", title: "Raghav's rules", blurb: "The five rules and the windows they look at. Change a number and the next planning run uses it." },
  { id: "review", title: "Review and feedback", blurb: "How runs reach Raghav, and when a rule that keeps being changed is queued for a second look." },
  { id: "data", title: "Data checks", blurb: "What the planning run insists on before it will produce anything." },
];

export default async function RulesPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const { error, ok } = await searchParams;
  const snap = await getSnapshot();
  if (!snap) return <NotConnected />;
  const rules = await loadRules();
  const stats = perRuleStats(snap.decisions);
  const show = (key: keyof Rules, kind: string) => (kind === "pct" ? String(Math.round(Number(rules[key]) * 10000) / 100) : String(rules[key]));

  return (
    <>
      <h1>Rules</h1>
      <p className="sub">
        These are Raghav&apos;s thresholds, stored in Neon and editable here. They never change by themselves: when one is changed or rejected too
        often, it is queued below for Raghav and Deepa to look at.
      </p>
      {error ? <div className="banner bad" role="alert">{error}</div> : null}
      {ok ? <div className="banner good" role="status">{ok}</div> : null}

      <form action={saveRules}>
        {GROUPS.map((g) => (
          <section key={g.id} className="card">
            <h2>{g.title}</h2>
            <p className="small dim" style={{ marginTop: -4 }}>{g.blurb}</p>
            <div className="rulegrid">
              {RULE_DEFS.filter((d) => d.group === g.id).map((d) => (
                <label key={d.key} className="rulefield">
                  <span className="rulelabel">{d.label}</span>
                  {d.kind === "bool" ? (
                    <select name={d.key} defaultValue={String(rules[d.key])}>
                      <option value="true">On</option>
                      <option value="false">Off</option>
                    </select>
                  ) : (
                    <span className="inputrow">
                      <input name={d.key} type="text" inputMode="decimal" defaultValue={show(d.key, d.kind)} />
                      {d.kind === "pct" ? <span className="unit">%</span> : null}
                    </span>
                  )}
                  <span className="small dim">{d.help}</span>
                </label>
              ))}
            </div>
          </section>
        ))}
        <div className="btns" style={{ marginBottom: 12 }}>
          <button className="btn primary" type="submit">Save rules</button>
        </div>
      </form>
      <form action={resetRules} style={{ marginBottom: 24 }}>
        <button className="btn" type="submit">Reset to Raghav&apos;s original numbers</button>
      </form>

      <section className="grid two">
        <div className="card">
          <h2>How often each rule is changed or rejected</h2>
          <table>
            <thead><tr><th>Rule flag</th><th className="num">Decisions</th><th className="num">Changed or rejected</th><th className="num">Rate</th></tr></thead>
            <tbody>
              {stats.map((r) => (
                <tr key={r.rule}>
                  <td>{r.rule}</td><td className="num">{r.total}</td><td className="num">{r.changed}</td>
                  <td className="num"><span className={`pill ${r.rate > ADOPTION_KILL ? "breach" : "ok"}`}>{pct(r.rate)}</span></td>
                </tr>
              ))}
              {!stats.length ? <tr><td colSpan={4} className="dim">No decisions yet.</td></tr> : null}
            </tbody>
          </table>
          <p className="small dim" style={{ marginBottom: 0 }}>A decision with two flags counts once for each rule.</p>
        </div>

        <div className="card">
          <h2>Rules waiting for a second look</h2>
          {snap.ruleReviews.filter((r) => r.status === "OPEN").map((r) => (
            <div key={r.id} style={{ borderBottom: "1px solid var(--border)", padding: "10px 0" }}>
              <div><strong>{r.rule}</strong> <span className="pill warn">{r.changed} of {r.total} changed or rejected ({r.rate})</span></div>
              <div className="small dim">Opened {fmtDateTime(r.opened_at)}</div>
              {r.proposal ? <p style={{ margin: "6px 0" }}>{r.proposal}<span className="small dim"> (a suggestion drafted by Gemini; you decide)</span></p> : null}
              <div className="btns" style={{ marginTop: 6 }}>
                {!r.proposal ? (
                  <form action={askProposal}>
                    <input type="hidden" name="id" value={r.id} />
                    <button className="btn" type="submit" disabled={!geminiConfigured()} title={geminiConfigured() ? "" : "Needs GEMINI_API_KEY"}>Ask Gemini for a suggestion</button>
                  </form>
                ) : null}
                <form action={closeReview}><input type="hidden" name="id" value={r.id} /><button className="btn" type="submit">Mark as reviewed</button></form>
              </div>
            </div>
          ))}
          {!snap.ruleReviews.some((r) => r.status === "OPEN") ? <p className="dim" style={{ margin: 0 }}>Nothing waiting.</p> : null}
        </div>
      </section>
    </>
  );
}
