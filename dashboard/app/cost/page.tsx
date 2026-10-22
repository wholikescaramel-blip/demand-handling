import { getSnapshot } from "@/lib/data";
import { estimateCostInr } from "@/lib/metrics";
import { DemoBanner, Kpi, fmtDateTime } from "@/components/ui";
import { TokensChart } from "@/components/Charts";

export const dynamic = "force-dynamic";

export default async function CostPage() {
  const snap = await getSnapshot();
  const ok = snap.runs.filter((r) => r.status === "OK");
  const bad = snap.runs.filter((r) => r.status !== "OK");
  const tokens = snap.runs.reduce((s, r) => s + r.gemini_tokens, 0);
  const perMillion = process.env.GEMINI_COST_PER_MILLION_TOKENS_INR ? Number(process.env.GEMINI_COST_PER_MILLION_TOKENS_INR) : null;
  const cost = estimateCostInr(tokens, perMillion);
  const lastTokens = ok[0]?.gemini_tokens ?? 0;
  const series = ok.slice().reverse().map((r) => ({ label: r.as_of ?? r.run_at.slice(0, 10), tokens: r.gemini_tokens }));

  return (
    <>
      <DemoBanner demo={snap.demo} />
      <h1>Cost &amp; health</h1>
      <p className="sub">What the tool costs to run, and whether the pipeline is healthy.</p>

      <section className="grid kpis">
        <Kpi label="Runs" value={snap.runs.length} note={`${bad.length} aborted or failed`} />
        <Kpi label="Gemini tokens (all runs)" value={tokens.toLocaleString("en-IN")} note={`${lastTokens.toLocaleString("en-IN")} in the latest run`} />
        <Kpi label="Gemini cost" value={cost === null ? "Rs 0" : `Rs ${cost.toFixed(2)}`} note={cost === null ? "Free tier. Set a price to estimate paid use." : "Estimate at the configured price"} />
        <Kpi label="Hosting & database" value="Rs 0" note="Sheets, Apps Script, Neon, Vercel: free plans" />
      </section>

      <section className="grid two">
        <div className="card">
          <h2>Gemini tokens per run</h2>
          <TokensChart data={series} />
        </div>
        <div className="card">
          <h2>Run history</h2>
          <div className="tablewrap">
            <table>
              <thead><tr><th>Run</th><th>Mode</th><th className="num">Complete</th><th className="num">Flagged</th><th>Status</th></tr></thead>
              <tbody>
                {snap.runs.map((r) => (
                  <tr key={r.run_id}>
                    <td><span className="small">{fmtDateTime(r.run_at)}</span><div className="small dim">{r.run_id}</div></td>
                    <td>{r.mode ?? "—"}</td>
                    <td className="num">{r.completeness === null ? "—" : `${r.completeness}%`}</td>
                    <td className="num">{r.flagged ?? "—"}</td>
                    <td>
                      <span className={`pill ${r.status === "OK" ? "ok" : "breach"}`}>{r.status}</span>
                      {r.notes ? <div className="small dim">{r.notes}</div> : null}
                    </td>
                  </tr>
                ))}
                {!snap.runs.length ? <tr><td colSpan={5} className="dim">No runs yet.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </>
  );
}
