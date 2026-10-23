import { dbConfigured } from "@/lib/db";
import { loadStock } from "@/lib/planning";
import type { StockStatus } from "@/lib/engine";
import { NotConnected } from "@/components/NotConnected";

export const dynamic = "force-dynamic";

const STATUS: Record<StockStatus, { label: string; cls: string }> = {
  STOCKOUT: { label: "Stockout risk", cls: "breach" },
  OVERSTOCK: { label: "Overstock", cls: "warn" },
  HIGH_DEMAND: { label: "High demand", cls: "warn" },
  OK: { label: "In range", cls: "ok" },
  NEW: { label: "New SKU", cls: "na" },
  NO_DATA: { label: "No stock record", cls: "na" },
};

/** Cover against its target band: a bar that runs to 2x the ceiling with the band shaded. */
function Gauge({ cover, floor, ceiling }: { cover: number | null; floor: number; ceiling: number }) {
  if (cover === null) return <span className="dim">n/a</span>;
  const max = ceiling * 1.5;
  const at = (w: number) => `${Math.min(100, (w / max) * 100)}%`;
  return (
    <span className="gauge" role="img" aria-label={`${cover} weeks of cover; target ${floor} to ${ceiling} weeks`}>
      <span className="band" style={{ left: at(floor), width: `calc(${at(ceiling)} - ${at(floor)})` }} />
      <span className="dot" style={{ left: at(cover) }} />
    </span>
  );
}

export default async function StockPage() {
  if (!dbConfigured()) return <NotConnected />;
  const s = await loadStock();
  if (!s.ok) {
    return (
      <>
        <h1>Stock</h1>
        <div className="banner bad" role="alert">{s.message}</div>
      </>
    );
  }
  const urgent = s.rows.filter((r) => r.priority > 0).length;

  return (
    <>
      <h1>Stock</h1>
      <p className="sub">
        Every SKU, most urgent first. Stock as of {s.asOf}{s.festival ? " · festival month, demand counted +" + Math.round(s.rules.FESTIVAL_UPLIFT * 100) + "%" : ""} · {urgent} need attention.
        Target is {s.rules.STOCKOUT_WEEKS} to {s.rules.OVERSTOCK_WEEKS} weeks of cover ({s.rules.PERISHABLE_MIN_WEEKS} to {s.rules.PERISHABLE_MAX_WEEKS} for perishables).
      </p>

      <section className="card">
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>SKU</th><th className="num">In hand</th><th className="num">On order</th><th className="num">Demand / wk</th>
                <th className="num">Weeks of cover</th><th>Target band</th><th>Status</th><th>Gap</th>
              </tr>
            </thead>
            <tbody>
              {s.rows.map((r) => {
                const st = STATUS[r.status];
                return (
                  <tr key={r.sku}>
                    <td>
                      <strong>{r.sku}</strong> <span className="dim">{r.name}</span>
                      <div className="small dim">{r.distributor ? (s.distName.get(r.distributor) ?? r.distributor) : "no vendor"}{r.perishable ? " · perishable" : ""}</div>
                    </td>
                    <td className="num">{r.onHand ?? "n/a"}</td>
                    <td className="num">{r.openPo || "—"}</td>
                    <td className="num">{r.weeklyDemand ?? "—"}</td>
                    <td className="num"><strong>{r.coverWeeks ?? "—"}</strong></td>
                    <td>
                      <Gauge cover={r.coverWeeks} floor={r.floorWeeks} ceiling={r.ceilingWeeks} />
                      <div className="small dim">{r.floorWeeks} to {r.ceilingWeeks} wks</div>
                    </td>
                    <td><span className={`pill ${st.cls}`}>{st.label}</span></td>
                    <td className="small">
                      {r.unitsToFloor > 0 ? `${r.unitsToFloor} short of ${r.floorWeeks} wks` : r.unitsOverCeiling > 0 ? `${r.unitsOverCeiling} over ${r.ceilingWeeks} wks` : "—"}
                    </td>
                  </tr>
                );
              })}
              {!s.rows.length ? <tr><td colSpan={8} className="dim">No SKUs in the database.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
