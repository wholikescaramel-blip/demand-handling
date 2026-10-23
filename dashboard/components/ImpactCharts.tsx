"use client";

import {
  Area, AreaChart, Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { ImpactPoint } from "@/lib/impact";

const axis = { stroke: "var(--muted)", fontSize: 12 } as const;
const tip = {
  contentStyle: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)" },
  labelStyle: { color: "var(--text)" },
} as const;
const L = 100000;
const fmt = (v: unknown) => `Rs ${Number(v).toFixed(2)} L`;

function short(week: string) {
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", timeZone: "UTC" }).format(new Date(`${week}T00:00:00Z`));
}

/** Weekly losses (stacked) against the pre-AI weekly baseline. Lower bars are better. */
export function LossChart({ data }: { data: ImpactPoint[] }) {
  if (!data.length) return <p className="dim">No weekly entries yet. Add the first one below.</p>;
  const rows = data.map((d) => ({ week: short(d.week), stockout: d.stockout / L, overstock: d.overstock / L, baseline: d.baseline / L }));
  return (
    <div role="img" aria-label="Weekly losses from stockouts and overstock as stacked bars, against a dashed pre-AI baseline line" style={{ width: "100%", height: 280 }}>
      <ResponsiveContainer>
        <ComposedChart data={rows} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="week" tick={axis} stroke="var(--border)" />
          <YAxis tick={axis} stroke="var(--border)" unit=" L" />
          <Tooltip {...tip} formatter={(v) => fmt(v)} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar isAnimationActive={false} dataKey="stockout" name="Stockout losses" stackId="a" fill="var(--bad)" />
          <Bar isAnimationActive={false} dataKey="overstock" name="Overstock write-offs" stackId="a" fill="var(--pause)" />
          <Line isAnimationActive={false} type="monotone" dataKey="baseline" name="Pre-AI weekly baseline" stroke="var(--text)" strokeDasharray="6 4" strokeWidth={2} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Running total of what the system has saved compared with the baseline. Above zero is good. */
export function SavedChart({ data }: { data: ImpactPoint[] }) {
  if (!data.length) return <p className="dim">The savings line starts with the first weekly entry.</p>;
  const rows = data.map((d) => ({ week: short(d.week), saved: d.cumSaved / L }));
  return (
    <div role="img" aria-label="Line chart of cumulative savings against the baseline" style={{ width: "100%", height: 280 }}>
      <ResponsiveContainer>
        <AreaChart data={rows} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="week" tick={axis} stroke="var(--border)" />
          <YAxis tick={axis} stroke="var(--border)" unit=" L" />
          <Tooltip {...tip} formatter={(v) => [fmt(v), "Saved so far"]} />
          <ReferenceLine y={0} stroke="var(--muted)" />
          <Area isAnimationActive={false} type="monotone" dataKey="saved" stroke="var(--healthy)" fill="var(--healthy)" fillOpacity={0.18} strokeWidth={2.5} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
