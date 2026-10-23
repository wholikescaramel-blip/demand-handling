/**
 * Impact tracker: are weekly planning losses (stockout losses + overstock write-offs) lower than before the system?
 * Pure functions, unit-tested. All money is in rupees.
 */

export type LossEntry = {
  week_start: string; // yyyy-mm-dd (Monday)
  stockout_loss: number;
  overstock_writeoff: number;
  perishable_part: number; // part of overstock_writeoff that was perishable
  note: string | null;
  entered_by: string | null;
};

export type ImpactSettings = {
  go_live: string | null; // yyyy-mm-dd; null = not set (the dashboard falls back to the first live run)
  baseline_low: number; // pre-AI planning-error cost per QUARTER, low end (Rs 28 lakh)
  baseline_high: number; // high end (Rs 34 lakh)
  baseline_perishable_quarter: number | null; // optional: perishable write-offs per quarter before the system
  horizon_days: number; // evaluation point (90)
  target_pct: number; // 0.30: the outcome the project aimed for
  kill_pct: number; // 0.10: below this at the horizon, go back to manual
};

export const IMPACT_DEFAULTS: ImpactSettings = {
  go_live: null,
  baseline_low: 2_800_000,
  baseline_high: 3_400_000,
  baseline_perishable_quarter: null,
  horizon_days: 90,
  target_pct: 0.3,
  kill_pct: 0.1,
};

export const MIN_WEEKS = 4;
const WEEKS_PER_QUARTER = 13;
const DAY = 86400000;

const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);

export const total = (e: LossEntry) => e.stockout_loss + e.overstock_writeoff;

/** Weekly loss before the system: the middle of the quarterly range, spread over 13 weeks. */
export function weeklyBaseline(s: ImpactSettings): number {
  return (s.baseline_low + s.baseline_high) / 2 / WEEKS_PER_QUARTER;
}

export type ImpactPoint = {
  week: string;
  loss: number;
  stockout: number;
  overstock: number;
  baseline: number;
  cumSaved: number;
};

export type ImpactEval = {
  goLive: string | null;
  phase: "not_started" | "tracking" | "decision";
  day: number;
  daysLeft: number;
  horizon: number;
  weeks: number;
  baselineWeekly: number;
  avgWeekly: number | null;
  reductionPct: number | null;
  savedTotal: number | null;
  status: "na" | "on_target" | "improving" | "revert";
  verdict: string;
  perishableRising: boolean;
  series: ImpactPoint[];
};

export const lakh = (rupees: number) => `Rs ${(rupees / 100000).toFixed(2)} L`;

export function evaluateImpact(entries: LossEntry[], s: ImpactSettings, todayIso: string): ImpactEval {
  const baselineWeekly = weeklyBaseline(s);
  const base = {
    goLive: s.go_live, day: 0, daysLeft: s.horizon_days, horizon: s.horizon_days, weeks: 0, baselineWeekly,
    avgWeekly: null, reductionPct: null, savedTotal: null, perishableRising: false, series: [] as ImpactPoint[],
  };

  if (!s.go_live || ms(s.go_live) > ms(todayIso)) {
    return {
      ...base, phase: "not_started", status: "na",
      verdict: s.go_live ? `Go-live is ${s.go_live}. Tracking starts then.` : "No go-live date yet. It is set automatically by the first live run, or you can enter it below.",
    };
  }

  const day = Math.floor((ms(todayIso) - ms(s.go_live)) / DAY) + 1;
  const phase = day >= s.horizon_days ? "decision" : "tracking";
  // A week counts if any part of it falls on or after go-live.
  const counted = entries
    .filter((e) => ms(e.week_start) + 6 * DAY >= ms(s.go_live!))
    .sort((a, b) => (a.week_start < b.week_start ? -1 : 1));

  let cum = 0;
  const series: ImpactPoint[] = counted.map((e) => {
    cum += baselineWeekly - total(e);
    return { week: e.week_start, loss: total(e), stockout: e.stockout_loss, overstock: e.overstock_writeoff, baseline: baselineWeekly, cumSaved: cum };
  });

  const common = { goLive: s.go_live, phase, day, daysLeft: Math.max(0, s.horizon_days - day), horizon: s.horizon_days, weeks: counted.length, baselineWeekly, series } as const;

  if (counted.length < MIN_WEEKS) {
    const need = MIN_WEEKS - counted.length;
    return {
      ...common, avgWeekly: null, reductionPct: null, savedTotal: counted.length ? cum : null, perishableRising: false, status: "na",
      verdict: `Keep adding weekly numbers: ${need} more week(s) are needed before there is a reading.`,
    };
  }

  const avgWeekly = counted.reduce((a, e) => a + total(e), 0) / counted.length;
  const reductionPct = 1 - avgWeekly / baselineWeekly;
  const status = reductionPct >= s.target_pct ? "on_target" : reductionPct >= s.kill_pct ? "improving" : "revert";

  let perishableRising = false;
  if (s.baseline_perishable_quarter !== null) {
    const avgPer = counted.reduce((a, e) => a + e.perishable_part, 0) / counted.length;
    perishableRising = avgPer > s.baseline_perishable_quarter / WEEKS_PER_QUARTER;
  }

  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const dir = reductionPct >= 0 ? "below" : "above";
  const gap = `${pct(Math.abs(reductionPct))} ${dir} the pre-AI baseline`;
  let verdict: string;
  if (phase === "tracking") {
    verdict =
      status === "on_target" ? `On track: weekly losses are ${gap}, past the ${pct(s.target_pct)} target.`
      : status === "improving" ? `Improving: weekly losses are ${gap}, short of the ${pct(s.target_pct)} target. The call is made at day ${s.horizon_days}.`
      : `Not improving yet: weekly losses are ${gap}. The call is made at day ${s.horizon_days}.`;
  } else {
    verdict =
      status === "on_target" ? `Day ${s.horizon_days} reached: losses are ${gap}. Recommended: keep the system.`
      : status === "improving" ? `Day ${s.horizon_days} reached: losses are ${gap}, short of the ${pct(s.target_pct)} target. Review the rules with Deepa before deciding.`
      : `Day ${s.horizon_days} reached: losses are ${gap}. Recommended: shift back to manual planning.`;
  }
  if (perishableRising) verdict += " Perishable write-offs are above their baseline, which breaches the guardrail.";

  return { ...common, avgWeekly, reductionPct, savedTotal: cum, perishableRising, status, verdict };
}

/** Monday of the week containing `iso` (yyyy-mm-dd). */
export function mondayOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - back * DAY).toISOString().slice(0, 10);
}

/** Settings stored as strings in the settings table -> typed, with defaults. */
export function parseSettings(rows: { key: string; value: string | null }[], firstLiveRunAt: string | null): ImpactSettings {
  const m = new Map(rows.map((r) => [r.key, r.value]));
  const num = (k: string, d: number) => {
    const v = m.get(k);
    return v != null && v !== "" && isFinite(Number(v)) ? Number(v) : d;
  };
  const perishable = m.get("baseline_perishable_quarter");
  return {
    go_live: m.get("go_live") || (firstLiveRunAt ? firstLiveRunAt.slice(0, 10) : null),
    baseline_low: num("baseline_low", IMPACT_DEFAULTS.baseline_low),
    baseline_high: num("baseline_high", IMPACT_DEFAULTS.baseline_high),
    baseline_perishable_quarter: perishable != null && perishable !== "" && isFinite(Number(perishable)) ? Number(perishable) : null,
    horizon_days: num("horizon_days", IMPACT_DEFAULTS.horizon_days),
    target_pct: IMPACT_DEFAULTS.target_pct,
    kill_pct: IMPACT_DEFAULTS.kill_pct,
  };
}
