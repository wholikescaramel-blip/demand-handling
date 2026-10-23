/** Raghav's rules and the other knobs, with their defaults. Edited on the Rules page; stored in the Neon `rules` table. */

export type RuleKind = "number" | "pct" | "bool";
export type RuleGroup = "rules" | "data" | "review";

export type RuleDef = {
  key: keyof Rules;
  label: string;
  help: string;
  kind: RuleKind; // pct: stored as a fraction (0.2), shown and typed as a percentage (20)
  def: number | boolean;
  min?: number;
  max?: number;
  group: RuleGroup;
};

export type Rules = {
  HIGH_DEMAND_PCT: number;
  HIGH_DEMAND_QTY_MULT: number;
  STOCKOUT_WEEKS: number;
  OVERSTOCK_WEEKS: number;
  FESTIVAL_UPLIFT: number;
  PERISHABLE_MIN_WEEKS: number;
  PERISHABLE_MAX_WEEKS: number;
  TREND_RECENT_WEEKS: number;
  TREND_BASE_WEEKS: number;
  MIN_HISTORY_WEEKS: number;
  USE_OPEN_POS: boolean;
  SHADOW_MODE: boolean;
  COMPLETENESS_MIN: number;
  MAX_DATA_AGE_DAYS: number;
  ANOMALY_PCT: number;
  REVIEW_SLA_HOURS: number;
  OVERRIDE_ALERT_COUNT: number;
  OVERRIDE_ALERT_DAYS: number;
  ADOPTION_KILL_PCT: number;
};

export const RULE_DEFS: RuleDef[] = [
  { key: "HIGH_DEMAND_PCT", group: "rules", kind: "pct", def: 0.2, min: 0, max: 5, label: "Rule 1: high-demand threshold", help: "Flag a SKU as high-demand when its last 4 weeks of sales are this much above its 12-week average." },
  { key: "HIGH_DEMAND_QTY_MULT", group: "rules", kind: "number", def: 1.5, min: 1, max: 10, label: "Rule 1: reorder multiple", help: "A high-demand SKU is reordered at this multiple of its standard quantity (Standard_Reorder_Qty in the SKU data)." },
  { key: "STOCKOUT_WEEKS", group: "rules", kind: "number", def: 6, min: 0, max: 52, label: "Rule 2: stockout risk below (weeks of cover)", help: "Stock below this many weeks of average sales: stockout risk, reorder now." },
  { key: "OVERSTOCK_WEEKS", group: "rules", kind: "number", def: 14, min: 1, max: 104, label: "Rule 3: overstock risk above (weeks of cover)", help: "Stock above this many weeks of average sales: overstock risk, pause the next order." },
  { key: "FESTIVAL_UPLIFT", group: "rules", kind: "pct", def: 0.25, min: 0, max: 5, label: "Rule 4: festival uplift", help: "In festival months (the Calendar data) demand is raised by this much before the checks. It applies to the demand behind weeks of cover, not to the 4-week vs 12-week trend." },
  { key: "PERISHABLE_MIN_WEEKS", group: "rules", kind: "number", def: 3, min: 0, max: 52, label: "Rule 5: perishable minimum (weeks)", help: "High-perishability SKUs: below this many weeks of stock is a stockout risk (replaces the 6-week floor)." },
  { key: "PERISHABLE_MAX_WEEKS", group: "rules", kind: "number", def: 4, min: 1, max: 52, label: "Rule 5: perishable maximum (weeks)", help: "High-perishability SKUs: above this is overstock risk, and reorder quantities are capped so cover after the order stays within it." },
  { key: "TREND_RECENT_WEEKS", group: "rules", kind: "number", def: 4, min: 1, max: 26, label: "Recent-sales window (weeks)", help: "How many latest weeks count as 'recent' sales." },
  { key: "TREND_BASE_WEEKS", group: "rules", kind: "number", def: 12, min: 2, max: 104, label: "Baseline window (weeks)", help: "How many latest weeks make the average that recent sales are compared with." },
  { key: "MIN_HISTORY_WEEKS", group: "rules", kind: "number", def: 12, min: 1, max: 104, label: "Minimum history (weeks)", help: "A SKU with less history than this goes to Raghav as a manual review (new launches)." },
  { key: "USE_OPEN_POS", group: "rules", kind: "bool", def: true, label: "Count POs already placed as stock", help: "Purchase orders created here and not yet marked received count as stock on order, so a SKU is not flagged for a second order." },
  { key: "SHADOW_MODE", group: "review", kind: "bool", def: false, label: "Shadow mode", help: "On: runs are logged but nothing is sent for review (use for the first weeks, to compare with Raghav's manual process). Off: every run goes to the Review page." },
  { key: "REVIEW_SLA_HOURS", group: "review", kind: "number", def: 24, min: 1, max: 168, label: "Review deadline (hours)", help: "How long Raghav has to decide a run before it is shown as overdue." },
  { key: "OVERRIDE_ALERT_COUNT", group: "review", kind: "number", def: 3, min: 1, max: 100, label: "Open a rule review after this many changes", help: "When one rule has its quantity changed or is rejected this many times within the window below, it is queued for review." },
  { key: "OVERRIDE_ALERT_DAYS", group: "review", kind: "number", def: 28, min: 1, max: 365, label: "...within this many days", help: "The window for the count above." },
  { key: "ADOPTION_KILL_PCT", group: "review", kind: "pct", def: 0.6, min: 0.05, max: 1, label: "Adoption kill line", help: "If more than this share of decisions have a changed quantity or are rejected, for four straight weeks, the rules do not reflect Raghav's judgement." },
  { key: "COMPLETENESS_MIN", group: "data", kind: "pct", def: 0.95, min: 0.5, max: 1, label: "Minimum data completeness", help: "A run stops without producing anything if less than this share of SKU x week sales rows is present." },
  { key: "MAX_DATA_AGE_DAYS", group: "data", kind: "number", def: 4, min: 1, max: 60, label: "Warn when stock data is older than (days)", help: "Recommendations carry a stale-data note when the latest stock date is older than this." },
  { key: "ANOMALY_PCT", group: "data", kind: "pct", def: 0.35, min: 0.05, max: 5, label: "Anomaly threshold", help: "Mention an anomaly when the latest week differs from the 12-week average by more than this." },
];

export function defaultRules(): Rules {
  const r: Record<string, number | boolean> = {};
  for (const d of RULE_DEFS) r[d.key] = d.def;
  return r as unknown as Rules;
}

/** Defaults overlaid with whatever is stored in the rules table. Bad stored values fall back to the default. */
export function mergeRules(rows: { key: string; value: string | null }[]): Rules {
  const rules = defaultRules() as unknown as Record<string, number | boolean>;
  for (const row of rows) {
    const d = RULE_DEFS.find((x) => x.key === row.key);
    if (!d || row.value === null) continue;
    if (d.kind === "bool") rules[d.key] = row.value === "true";
    else if (row.value.trim() !== "" && isFinite(Number(row.value))) rules[d.key] = Number(row.value);
  }
  return rules as unknown as Rules;
}

/** Validate what was typed on the Rules page. pct fields are typed as 20 for 20%. */
export function parseRuleInput(d: RuleDef, raw: string): { ok: true; value: number | boolean } | { ok: false; error: string } {
  if (d.kind === "bool") return { ok: true, value: raw === "true" || raw === "on" };
  const s = raw.trim().replace(/,/g, "");
  if (s === "" || !isFinite(Number(s))) return { ok: false, error: `${d.label}: enter a number.` };
  let n = Number(s);
  if (d.kind === "pct") n = n / 100;
  const round = (x: number) => Math.round(x * 10000) / 10000;
  n = round(n);
  if ((d.min !== undefined && n < d.min) || (d.max !== undefined && n > d.max)) {
    const show = (x: number) => (d.kind === "pct" ? `${round(x * 100)}%` : String(x));
    return { ok: false, error: `${d.label}: must be between ${show(d.min ?? -Infinity)} and ${show(d.max ?? Infinity)}.` };
  }
  if (d.kind === "number" && ["TREND_RECENT_WEEKS", "TREND_BASE_WEEKS", "MIN_HISTORY_WEEKS", "OVERRIDE_ALERT_COUNT", "OVERRIDE_ALERT_DAYS", "REVIEW_SLA_HOURS", "MAX_DATA_AGE_DAYS"].includes(d.key) && !Number.isInteger(n)) {
    return { ok: false, error: `${d.label}: use a whole number.` };
  }
  return { ok: true, value: n };
}

/** Cross-field sanity checks (for example the floor must stay below the ceiling). */
export function checkRules(r: Rules): string[] {
  const errs: string[] = [];
  if (r.STOCKOUT_WEEKS >= r.OVERSTOCK_WEEKS) errs.push("The stockout threshold must be below the overstock threshold.");
  if (r.PERISHABLE_MIN_WEEKS >= r.PERISHABLE_MAX_WEEKS) errs.push("The perishable minimum must be below the perishable maximum.");
  if (r.TREND_RECENT_WEEKS >= r.TREND_BASE_WEEKS) errs.push("The recent-sales window must be shorter than the baseline window.");
  if (r.MIN_HISTORY_WEEKS < r.TREND_BASE_WEEKS) errs.push("Minimum history must be at least as long as the baseline window.");
  return errs;
}
