import { getSnapshot } from "@/lib/data";
import { decisionStats } from "@/lib/metrics";
import { ActionPill, DecisionPill, DemoBanner, fmtDateTime, pct } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function DecisionsPage() {
  const snap = await getSnapshot();
  const stats = decisionStats(snap.decisions);
  return (
    <>
      <DemoBanner demo={snap.demo} />
      <h1>Review log</h1>
      <p className="sub">
        Every decision Raghav made, newest first. {stats.decided} decided · {pct(stats.changedRate)} changed or rejected ·{" "}
        {stats.expired} expired.
      </p>
      <section className="card">
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>When</th><th>SKU</th><th>Recommended</th><th>Decision</th><th className="num">Final qty</th>
                <th>Reason for change</th><th className="num">Hours</th><th>Reviewer</th>
              </tr>
            </thead>
            <tbody>
              {snap.decisions.map((d) => (
                <tr key={`${d.run_id}-${d.sku}`}>
                  <td className="small">{fmtDateTime(d.decided_at)}</td>
                  <td><strong>{d.sku}</strong><div className="small dim">{d.flags}</div></td>
                  <td>{d.action ? <ActionPill action={d.action} /> : null}<div className="small dim">qty {d.rec_qty ?? "—"}</div></td>
                  <td><DecisionPill decision={d.decision} /></td>
                  <td className="num">{d.final_qty ?? "—"}</td>
                  <td className="reason">{d.reason ?? <span className="dim">—</span>}</td>
                  <td className="num">{d.hours_to_decide ?? "—"}</td>
                  <td className="small">{d.reviewer}</td>
                </tr>
              ))}
              {!snap.decisions.length ? <tr><td colSpan={8} className="dim">No decisions yet. They sync when Raghav clicks Finalise decisions in the Sheet.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
