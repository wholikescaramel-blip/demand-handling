import type { Decision, Run } from "./types.ts";

export const ADOPTION_KILL = 0.4;
export const NOISE_KILL = 0.3;
export const COMPLETENESS_GATE = 95;
export const SLA_HOURS = 24;

export type DecisionStats = {
  approve: number;
  override: number;
  reject: number;
  expired: number;
  decided: number; // approve + override + reject (expired excluded)
  changedRate: number | null; // (override + reject) / decided
  rejectRate: number | null;
  avgHours: number | null;
  slaRate: number | null; // share decided within SLA_HOURS
};

export function decisionStats(decisions: Decision[]): DecisionStats {
  const count = (d: string) => decisions.filter((x) => x.decision === d).length;
  const approve = count("Approve");
  const override = count("Override");
  const reject = count("Reject");
  const expired = count("EXPIRED");
  const decided = approve + override + reject;
  const hours = decisions
    .filter((d) => d.decision !== "EXPIRED" && d.hours_to_decide !== null)
    .map((d) => d.hours_to_decide as number);
  return {
    approve, override, reject, expired, decided,
    changedRate: decided ? (override + reject) / decided : null,
    rejectRate: decided ? reject / decided : null,
    avgHours: hours.length ? hours.reduce((a, b) => a + b, 0) / hours.length : null,
    slaRate: hours.length ? hours.filter((h) => h <= SLA_HOURS).length / hours.length : null,
  };
}

/** ISO week label like 2026-W43 (UTC). */
export function isoWeek(iso: string): string {
  const d = new Date(iso);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export type WeekPoint = { week: string; rate: number; n: number };

/** Override + reject rate per ISO week, oldest first. EXPIRED rows are ignored. */
export function weeklyChangeRate(decisions: Decision[]): WeekPoint[] {
  const by = new Map<string, { n: number; changed: number }>();
  for (const d of decisions) {
    if (d.decision === "EXPIRED") continue;
    const w = isoWeek(d.decided_at);
    const b = by.get(w) ?? { n: 0, changed: 0 };
    b.n++;
    if (d.decision === "Override" || d.decision === "Reject") b.changed++;
    by.set(w, b);
  }
  return [...by.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([week, b]) => ({ week, rate: b.changed / b.n, n: b.n }));
}

export type RuleStat = { rule: string; total: number; changed: number; rate: number };

/** Per rule flag (a decision with "A + B" flags counts for both). */
export function perRuleStats(decisions: Decision[]): RuleStat[] {
  const by = new Map<string, { total: number; changed: number }>();
  for (const d of decisions) {
    if (d.decision === "EXPIRED") continue;
    for (const f of (d.flags ?? "").split(" + ").filter(Boolean)) {
      const b = by.get(f) ?? { total: 0, changed: 0 };
      b.total++;
      if (d.decision === "Override" || d.decision === "Reject") b.changed++;
      by.set(f, b);
    }
  }
  return [...by.entries()]
    .map(([rule, b]) => ({ rule, ...b, rate: b.changed / b.total }))
    .sort((a, b) => b.rate - a.rate);
}

export type KillCheck = {
  name: string;
  status: "ok" | "warn" | "breach" | "na";
  value: string;
  rule: string;
};

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function killChecks(latest: Run | null, stats: DecisionStats, weekly: WeekPoint[]): KillCheck[] {
  const checks: KillCheck[] = [];

  checks.push(
    latest?.completeness == null
      ? { name: "Data completeness", status: "na", value: "no run yet", rule: `Stop if below ${COMPLETENESS_GATE}%` }
      : {
          name: "Data completeness",
          status: latest.completeness >= COMPLETENESS_GATE ? "ok" : "breach",
          value: `${latest.completeness}%`,
          rule: `Stop if below ${COMPLETENESS_GATE}%`,
        },
  );

  const last4 = weekly.slice(-4);
  if (!last4.length) {
    checks.push({ name: "Adoption (override + reject rate)", status: "na", value: "no decisions yet", rule: `Stop if above ${pct(ADOPTION_KILL)} for 4 straight weeks` });
  } else {
    const allOver = last4.length === 4 && last4.every((w) => w.rate > ADOPTION_KILL);
    const latestOver = last4[last4.length - 1].rate > ADOPTION_KILL;
    checks.push({
      name: "Adoption (override + reject rate)",
      status: allOver ? "breach" : latestOver ? "warn" : "ok",
      value: `${pct(stats.changedRate ?? 0)} overall, ${pct(last4[last4.length - 1].rate)} this week`,
      rule: `Stop if above ${pct(ADOPTION_KILL)} for 4 straight weeks`,
    });
  }

  checks.push(
    stats.rejectRate === null
      ? { name: "Noise (reject rate, proxy for false alarms)", status: "na", value: "no decisions yet", rule: `Stop if above ${pct(NOISE_KILL)}` }
      : {
          name: "Noise (reject rate, proxy for false alarms)",
          status: stats.rejectRate > NOISE_KILL ? "breach" : "ok",
          value: pct(stats.rejectRate),
          rule: `Stop if above ${pct(NOISE_KILL)}`,
        },
  );

  checks.push(
    stats.slaRate === null
      ? { name: `Decided within ${SLA_HOURS}h`, status: "na", value: "no decisions yet", rule: "Handoff promise to procurement" }
      : {
          name: `Decided within ${SLA_HOURS}h`,
          status: stats.slaRate >= 0.8 ? "ok" : "warn",
          value: pct(stats.slaRate),
          rule: "Aim for 80% or more",
        },
  );

  checks.push({
    name: "Harm (perishable write-offs)",
    status: "na",
    value: "needs finance ledger",
    rule: "Stop if write-offs rise vs baseline in any month",
  });

  return checks;
}

export function estimateCostInr(tokens: number, perMillionInr: number | null): number | null {
  if (perMillionInr === null || !isFinite(perMillionInr)) return null;
  return (tokens / 1_000_000) * perMillionInr;
}

export type RunPoint = { label: string; reorder: number; pause: number; manual: number; healthy: number; mode: string };

/** Chart series: oldest first, successful runs only. */
export function runSeries(runs: Run[]): RunPoint[] {
  return runs
    .filter((r) => r.status === "OK")
    .slice()
    .reverse()
    .map((r) => ({
      label: r.as_of ?? r.run_at.slice(0, 10),
      reorder: r.n_reorder,
      pause: r.n_pause,
      manual: r.n_manual,
      healthy: r.healthy ?? 0,
      mode: r.mode ?? "",
    }));
}
