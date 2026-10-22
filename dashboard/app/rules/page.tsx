import { getSnapshot } from "@/lib/data";
import { ADOPTION_KILL, perRuleStats } from "@/lib/metrics";
import { DemoBanner, fmtDateTime, pct } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function RulesPage() {
  const snap = await getSnapshot();
  const rules = perRuleStats(snap.decisions);
  return (
    <>
      <DemoBanner demo={snap.demo} />
      <h1>Rules</h1>
      <p className="sub">
        How often each rule is overridden or rejected. Rules never change themselves: a rule that is changed 3 or more times in 28 days
        opens a review, Gemini drafts a proposal, and Raghav and Deepa decide.
      </p>

      <section className="grid two">
        <div className="card">
          <h2>Change rate by rule</h2>
          <table>
            <thead><tr><th>Rule flag</th><th className="num">Decisions</th><th className="num">Changed</th><th className="num">Rate</th></tr></thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.rule}>
                  <td>{r.rule}</td><td className="num">{r.total}</td><td className="num">{r.changed}</td>
                  <td className="num">
                    <span className={`pill ${r.rate > ADOPTION_KILL ? "breach" : "ok"}`}>{pct(r.rate)}</span>
                  </td>
                </tr>
              ))}
              {!rules.length ? <tr><td colSpan={4} className="dim">No decisions yet.</td></tr> : null}
            </tbody>
          </table>
          <p className="small dim" style={{ marginBottom: 0 }}>A decision with two flags counts once for each rule.</p>
        </div>

        <div className="card">
          <h2>Raghav&apos;s five rules</h2>
          <ol style={{ margin: 0, paddingLeft: 20 }}>
            <li>Last 4 weeks above the 12-week average by more than 20%: high-demand, reorder 1.5x the standard quantity.</li>
            <li>Stock below 6 weeks of average sales: stockout risk, reorder now.</li>
            <li>Stock above 14 weeks: overstock risk, pause the next order.</li>
            <li>Festival months (Oct, Nov, Mar): +25% demand before the checks.</li>
            <li>High-perishability SKUs: 3 to 4 weeks of stock.</li>
          </ol>
          <p className="small dim" style={{ marginBottom: 0 }}>Edit the numbers in the Rules_Config tab of the Sheet.</p>
        </div>
      </section>

      <section className="card">
        <h2>Rule review queue</h2>
        <div className="tablewrap">
          <table>
            <thead><tr><th>Opened</th><th>Rule</th><th className="num">Changed / decided</th><th>Gemini proposal (text only)</th><th>Status</th></tr></thead>
            <tbody>
              {snap.ruleReviews.map((r) => (
                <tr key={`${r.opened_at}-${r.rule}`}>
                  <td className="small">{fmtDateTime(r.opened_at)}</td>
                  <td>{r.rule}</td>
                  <td className="num">{r.changed} / {r.total} ({r.rate})</td>
                  <td className="reason">{r.proposal || <span className="dim">Not drafted yet</span>}</td>
                  <td><span className={`pill ${r.status === "OPEN" ? "warn" : "ok"}`}>{r.status}</span></td>
                </tr>
              ))}
              {!snap.ruleReviews.length ? <tr><td colSpan={5} className="dim">Nothing to review.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
