"use client";

import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { RunPoint, WeekPoint } from "@/lib/metrics";

const axis = { stroke: "var(--muted)", fontSize: 12 } as const;
const tip = {
  contentStyle: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)" },
  labelStyle: { color: "var(--text)" },
} as const;

export function RunsChart({ data }: { data: RunPoint[] }) {
  if (!data.length) return <p className="dim">No runs yet.</p>;
  return (
    <div role="img" aria-label="Stacked bars of reorder, pause and manual-review flags per run" style={{ width: "100%", height: 260 }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="label" tick={axis} stroke="var(--border)" />
          <YAxis allowDecimals={false} tick={axis} stroke="var(--border)" />
          <Tooltip {...tip} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar isAnimationActive={false} dataKey="reorder" name="Reorder" stackId="a" fill="var(--reorder)" />
          <Bar isAnimationActive={false} dataKey="pause" name="Pause" stackId="a" fill="var(--pause)" />
          <Bar isAnimationActive={false} dataKey="manual" name="Manual review" stackId="a" fill="var(--manual)" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ChangeRateChart({ data, kill }: { data: WeekPoint[]; kill: number }) {
  if (!data.length) return <p className="dim">No review decisions yet. They appear after the first Finalise in the Sheet.</p>;
  const rows = data.map((d) => ({ ...d, pct: Math.round(d.rate * 100) }));
  return (
    <div role="img" aria-label="Line chart of the weekly override and reject rate against the 40 percent line" style={{ width: "100%", height: 260 }}>
      <ResponsiveContainer>
        <LineChart data={rows} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="week" tick={axis} stroke="var(--border)" />
          <YAxis domain={[0, 100]} unit="%" tick={axis} stroke="var(--border)" />
          <Tooltip {...tip} formatter={(v) => [`${v}%`, "Changed or rejected"]} />
          <ReferenceLine y={kill * 100} stroke="var(--bad)" strokeDasharray="5 4" label={{ value: `${kill * 100}% kill line`, fill: "var(--bad)", fontSize: 12, position: "insideTopRight" }} />
          <Line isAnimationActive={false} type="monotone" dataKey="pct" stroke="var(--reorder)" strokeWidth={2.5} dot={{ r: 4 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function TokensChart({ data }: { data: { label: string; tokens: number }[] }) {
  if (!data.length) return <p className="dim">No runs yet.</p>;
  return (
    <div role="img" aria-label="Bar chart of Gemini tokens used per run" style={{ width: "100%", height: 220 }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, left: -4, bottom: 0 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="label" tick={axis} stroke="var(--border)" />
          <YAxis tick={axis} stroke="var(--border)" />
          <Tooltip {...tip} />
          <Bar isAnimationActive={false} dataKey="tokens" name="Tokens" fill="var(--manual)" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
