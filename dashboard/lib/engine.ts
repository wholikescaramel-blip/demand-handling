/**
 * Raghav's rules as pure functions (no database, no network): unit-tested.
 *
 * Decisions made where the brief was ambiguous (all editable on the Rules page):
 *  - "Standard quantity"  = the SKU's Standard_Reorder_Qty.
 *  - Festival uplift      = +25% on the demand used for weeks-of-cover. It is NOT applied to the 4-wk vs 12-wk trend
 *                           (applying it to only one side would flag every SKU). The festival month comes from the
 *                           stock-data date.
 *  - Perishables (High)   = 3-4 week window replacing 6/14. Reorder qty is capped so cover after the order never exceeds
 *                           the perishable max.
 *  - Precedence           = one recommendation per SKU:
 *                           STOCKOUT (+/- HIGH_DEMAND)  -> REORDER (1.5x std if high-demand, else 1x)
 *                           HIGH_DEMAND alone           -> REORDER 1.5x std
 *                           OVERSTOCK alone             -> PAUSE the next order
 *                           OVERSTOCK + HIGH_DEMAND     -> MANUAL_REVIEW (signals conflict, Raghav decides)
 *  - Short history        = fewer than MIN_HISTORY_WEEKS of sales -> MANUAL_REVIEW (the 15-20% judgment lane).
 *  - Priority score 1-100 = how far past its threshold the SKU is (a deterministic rule has no probability).
 *
 * The engine only recommends. Nothing is ordered until Raghav presses Approve.
 */
import type { Rules } from "./rules.ts";

export const ACTIONS = { REORDER: "REORDER", PAUSE: "PAUSE", MANUAL: "MANUAL_REVIEW" } as const;
export type Action = (typeof ACTIONS)[keyof typeof ACTIONS];

export type EngineSku = {
  sku_id: string;
  name: string;
  category: string | null;
  perishability: string; // Low | High
  std_reorder_qty: number;
  distributor_id: string | null;
  unit?: string | null;
  hsn?: string | null;
  unit_cost?: number | null;
  tax_pct?: number | null;
};

export type SalesRow = { sku: string; week: string; units: number };
export type CalendarRow = { year_month: string; is_festival: boolean };

export type EngineInput = {
  sales: SalesRow[];
  skus: EngineSku[];
  inventory: Record<string, number>; // current units on hand per SKU
  openPos: Record<string, number>; // units already on order per SKU
  calendar: CalendarRow[];
  rules: Rules;
  asOf: string; // yyyy-mm-dd, the stock-data date
  today?: string; // yyyy-mm-dd, for the staleness note
  manualSkus?: string[]; // SKUs whose stock or weekly demand was typed in by a person
};

export type Rec = {
  sku: string;
  name: string;
  category: string | null;
  perishable: boolean;
  distributor: string | null;
  stdQty: number;
  unit: string | null;
  hsn: string | null;
  unitCost: number | null;
  taxPct: number | null;
  onHand: number | null;
  openPo: number;
  festival: boolean;
  dq: string[];
  action: Action;
  qty: number | null;
  flags: string[];
  priority: number;
  avg12: number | null;
  avg4: number | null;
  trendPct: number | null;
  coverWeeks: number | null;
  floorWeeks?: number;
  ceilingWeeks?: number;
  notes: string[];
  anomaly?: string | null;
  reason: string;
};

export type EngineResult = {
  recs: Rec[];
  healthy: number;
  festival: boolean;
  anomalies: { sku: string; note: string }[];
  asOf: string;
  skuCount: number;
};

const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const round = (n: number, d = 0) => Math.round(n * 10 ** d) / 10 ** d;
const DAY = 86400000;

export function buildSalesIndex(rows: SalesRow[]): Record<string, { week: string; units: number }[]> {
  const idx: Record<string, { week: string; units: number }[]> = {};
  for (const r of rows) {
    const u = Number(r.units);
    if (!isFinite(u)) continue;
    (idx[r.sku] ??= []).push({ week: r.week, units: u });
  }
  for (const k of Object.keys(idx)) idx[k].sort((a, b) => (a.week < b.week ? -1 : a.week > b.week ? 1 : 0));
  return idx;
}

export function isFestivalMonth(calendar: CalendarRow[], asOf: string): boolean {
  const key = asOf.slice(0, 7);
  return calendar.find((c) => c.year_month === key)?.is_festival ?? false;
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);

type Base = Omit<Rec, "action" | "qty" | "flags" | "priority" | "avg12" | "avg4" | "trendPct" | "coverWeeks" | "notes" | "reason">;

export function evaluateSku(
  sku: EngineSku, history: { week: string; units: number }[], onHand: number | null, openPo: number,
  festival: boolean, rules: Rules, dq: string[],
): Rec | null {
  const base: Base = {
    sku: sku.sku_id, name: sku.name, category: sku.category, perishable: sku.perishability === "High", distributor: sku.distributor_id,
    stdQty: Number(sku.std_reorder_qty), unit: sku.unit ?? null, hsn: sku.hsn ?? null,
    unitCost: sku.unit_cost ?? null, taxPct: sku.tax_pct ?? null, onHand, openPo, festival, dq: dq.slice(),
  };
  const manual = (flag: string, note: string, priority: number, extra: Partial<Rec> = {}): Rec => ({
    ...base, action: ACTIONS.MANUAL, qty: null, flags: [flag], priority, avg12: null, avg4: null, trendPct: null, coverWeeks: null,
    notes: [note], reason: note, ...extra,
  });

  const units = history.map((h) => h.units);
  if (units.length < rules.MIN_HISTORY_WEEKS) {
    return manual("SHORT_HISTORY", `Only ${units.length} weeks of history (need ${rules.MIN_HISTORY_WEEKS}): needs Raghav's judgment.`, 50);
  }
  if (onHand === null || isNaN(onHand)) return manual("NO_INVENTORY", "No stock record for this SKU.", 50);

  const avg12 = mean(units.slice(-rules.TREND_BASE_WEEKS));
  const avg4 = mean(units.slice(-rules.TREND_RECENT_WEEKS));
  if (avg12 <= 0) {
    return manual("NO_SALES", `No sales in the last ${rules.TREND_BASE_WEEKS} weeks.`, 30, { avg12: 0, avg4 });
  }

  const trend = avg4 / avg12 - 1;
  const demand = avg12 * (festival ? 1 + rules.FESTIVAL_UPLIFT : 1);
  const supply = onHand + (rules.USE_OPEN_POS ? openPo : 0);
  const cover = supply / demand;

  const floor = base.perishable ? rules.PERISHABLE_MIN_WEEKS : rules.STOCKOUT_WEEKS;
  const ceiling = base.perishable ? rules.PERISHABLE_MAX_WEEKS : rules.OVERSTOCK_WEEKS;

  const flags: string[] = [];
  if (cover < floor) flags.push("STOCKOUT_RISK");
  if (cover > ceiling) flags.push("OVERSTOCK_RISK");
  if (trend > rules.HIGH_DEMAND_PCT) flags.push("HIGH_DEMAND");

  let anomaly: string | null = null;
  const last = units[units.length - 1];
  if (Math.abs(last / avg12 - 1) > rules.ANOMALY_PCT) anomaly = `Latest week ${last} vs 12-wk avg ${round(avg12, 0)}.`;

  if (!flags.length) return null;
  const has = (f: string) => flags.includes(f);
  let severity = 0;
  if (has("STOCKOUT_RISK")) severity = Math.max(severity, (floor - cover) / floor);
  if (has("OVERSTOCK_RISK")) severity = Math.max(severity, Math.min(1, (cover - ceiling) / ceiling));
  if (has("HIGH_DEMAND")) severity = Math.max(severity, Math.min(1, trend / 0.5));
  const priority = Math.max(1, Math.round(Math.min(100, severity * 100 * (base.perishable ? 1.25 : 1))));

  const out: Rec = {
    ...base, avg12: round(avg12, 1), avg4: round(avg4, 1), trendPct: round(trend * 100, 1), coverWeeks: round(cover, 1),
    floorWeeks: floor, ceilingWeeks: ceiling, flags, notes: [], anomaly, priority, action: ACTIONS.PAUSE, qty: 0, reason: "",
  };

  if (has("OVERSTOCK_RISK") && has("HIGH_DEMAND")) {
    out.action = ACTIONS.MANUAL;
    out.qty = null;
    out.notes.push("Overstocked but sales are accelerating: signals conflict.");
  } else if (has("STOCKOUT_RISK") || has("HIGH_DEMAND")) {
    const mult = has("HIGH_DEMAND") ? rules.HIGH_DEMAND_QTY_MULT : 1;
    let qty = Math.round(out.stdQty * mult);
    if (base.perishable) {
      const cap = Math.floor(ceiling * demand - supply);
      if (cap < qty) {
        qty = Math.max(0, cap);
        out.notes.push(`Qty capped so perishable stock stays within ${ceiling} weeks.`);
      }
    }
    out.action = ACTIONS.REORDER;
    out.qty = qty;
  }
  return out;
}

export function runEngine(input: EngineInput): EngineResult {
  const { rules } = input;
  const festival = isFestivalMonth(input.calendar, input.asOf);
  const idx = buildSalesIndex(input.sales);
  const dq: string[] = [];
  if (input.today && daysBetween(input.asOf, input.today) > rules.MAX_DATA_AGE_DAYS) {
    dq.push(`STALE_DATA (${daysBetween(input.asOf, input.today)} days old)`);
  }
  const manual = new Set(input.manualSkus ?? []);
  const recs: Rec[] = [];
  const anomalies: { sku: string; note: string }[] = [];
  let healthy = 0;
  for (const sku of input.skus) {
    const has = Object.prototype.hasOwnProperty.call(input.inventory, sku.sku_id);
    const rec = evaluateSku(sku, idx[sku.sku_id] ?? [], has ? Number(input.inventory[sku.sku_id]) : null, Number(input.openPos[sku.sku_id] ?? 0), festival, rules, manual.has(sku.sku_id) ? [...dq, "MANUAL_INPUT (stock or weekly demand entered by hand)"] : dq);
    if (!rec) {
      healthy++;
      continue;
    }
    if (rec.anomaly) anomalies.push({ sku: rec.sku, note: rec.anomaly });
    rec.reason = templateReason(rec, rules);
    recs.push(rec);
  }
  recs.sort((a, b) => b.priority - a.priority);
  return { recs, healthy, festival, anomalies, asOf: input.asOf, skuCount: input.skus.length };
}

export type StockStatus = "STOCKOUT" | "OVERSTOCK" | "HIGH_DEMAND" | "OK" | "NEW" | "NO_DATA";

export type StockRow = {
  sku: string;
  name: string;
  perishable: boolean;
  distributor: string | null;
  onHand: number | null;
  openPo: number; // units already on order
  weeklyDemand: number | null; // average weekly sales, raised by the festival uplift in a festival month
  coverWeeks: number | null; // (on hand + on order) / weekly demand
  floorWeeks: number; // target band: lowest acceptable weeks of cover
  ceilingWeeks: number; // target band: highest acceptable weeks of cover
  trendPct: number | null;
  status: StockStatus;
  manual: boolean; // stock or weekly demand was entered by hand
  priority: number; // 0 when nothing needs doing
  action: Action | null; // what the rules recommend, if anything
  recQty: number | null;
  unitsToFloor: number; // units short of the lowest acceptable cover
  unitsOverCeiling: number; // units above the highest acceptable cover
};

/** Every SKU with its stock position against its target band, most urgent first. Same maths as the planning run. */
export function stockRows(input: EngineInput): StockRow[] {
  const { rules } = input;
  const festival = isFestivalMonth(input.calendar, input.asOf);
  const idx = buildSalesIndex(input.sales);
  const rows = input.skus.map((sku): StockRow => {
    const units = (idx[sku.sku_id] ?? []).map((h) => h.units);
    const perishable = sku.perishability === "High";
    const floor = perishable ? rules.PERISHABLE_MIN_WEEKS : rules.STOCKOUT_WEEKS;
    const ceiling = perishable ? rules.PERISHABLE_MAX_WEEKS : rules.OVERSTOCK_WEEKS;
    const onHand = Object.prototype.hasOwnProperty.call(input.inventory, sku.sku_id) ? Number(input.inventory[sku.sku_id]) : null;
    const openPo = Number(input.openPos[sku.sku_id] ?? 0);
    const base = { sku: sku.sku_id, name: sku.name, perishable, manual: (input.manualSkus ?? []).includes(sku.sku_id), distributor: sku.distributor_id, onHand, openPo, floorWeeks: floor, ceilingWeeks: ceiling, unitsToFloor: 0, unitsOverCeiling: 0 };
    const none = (status: StockStatus): StockRow => ({ ...base, weeklyDemand: null, coverWeeks: null, trendPct: null, status, priority: 50, action: ACTIONS.MANUAL, recQty: null });

    if (units.length < rules.MIN_HISTORY_WEEKS) return none("NEW");
    if (onHand === null) return none("NO_DATA");
    const avg12 = mean(units.slice(-rules.TREND_BASE_WEEKS));
    if (avg12 <= 0) return none("NO_DATA");

    const avg4 = mean(units.slice(-rules.TREND_RECENT_WEEKS));
    const demand = avg12 * (festival ? 1 + rules.FESTIVAL_UPLIFT : 1);
    const supply = onHand + (rules.USE_OPEN_POS ? openPo : 0);
    const rec = evaluateSku(sku, idx[sku.sku_id] ?? [], onHand, openPo, festival, rules, []);
    const status: StockStatus = !rec ? "OK" : rec.flags.includes("STOCKOUT_RISK") ? "STOCKOUT" : rec.flags.includes("OVERSTOCK_RISK") ? "OVERSTOCK" : "HIGH_DEMAND";
    return {
      ...base, weeklyDemand: round(demand, 1), coverWeeks: round(supply / demand, 1), trendPct: round((avg4 / avg12 - 1) * 100, 1), status,
      priority: rec?.priority ?? 0, action: rec?.action ?? null, recQty: rec?.qty ?? null,
      unitsToFloor: Math.max(0, Math.ceil(floor * demand - supply)), unitsOverCeiling: Math.max(0, Math.floor(supply - ceiling * demand)),
    };
  });
  return rows.sort((a, b) => b.priority - a.priority || (a.coverWeeks ?? 1e9) - (b.coverWeeks ?? 1e9) || (a.sku < b.sku ? -1 : 1));
}

/** Deterministic plain-English reason. Used as the fallback whenever Gemini is unavailable or fails its number check. */
export function templateReason(rec: Rec, rules: Rules): string {
  if (rec.flags.some((f) => ["SHORT_HISTORY", "NO_INVENTORY", "NO_SALES"].includes(f))) return rec.notes[0];
  const parts: string[] = [];
  const uplift = rec.festival ? ` (festival +${Math.round(rules.FESTIVAL_UPLIFT * 100)}% applied)` : "";
  if (rec.flags.includes("STOCKOUT_RISK")) parts.push(`Stock covers ${rec.coverWeeks} weeks${uplift}, below the ${rec.floorWeeks}-week floor.`);
  if (rec.flags.includes("OVERSTOCK_RISK")) parts.push(`Stock covers ${rec.coverWeeks} weeks${uplift}, above the ${rec.ceilingWeeks}-week ceiling.`);
  if (rec.flags.includes("HIGH_DEMAND")) parts.push(`Last 4 weeks sold ${rec.trendPct}% above the 12-week average.`);
  return parts.concat(rec.notes).join(" ");
}
