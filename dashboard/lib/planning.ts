/**
 * Reading everything the rules need out of Neon, and the planning run itself: apply Raghav's rules, let Gemini word the
 * reasons, and write the recommendations back for Raghav and Deepa to review. The Stock page reads the same data live.
 */
import { getSql } from "./db.ts";
import { runEngine, stockRows, type EngineInput, type EngineResult, type EngineSku, type StockRow } from "./engine.ts";
import { explainRecs, geminiConfigured, summarizeRun } from "./gemini.ts";
import { generatePosForReady } from "./orders.ts";
import { aggregateOpenQty } from "./po.ts";
import { mergeRules, type Rules } from "./rules.ts";

export type PlanningResult = { ok: boolean; runId: string | null; mode: string | null; flagged: number; message: string };

export async function loadRules(): Promise<Rules> {
  const rows = await getSql()`select key, value from rules`;
  return mergeRules(rows.map((r) => ({ key: String(r.key), value: r.value as string | null })));
}

const istParts = () => {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, stamp: `${p.year}${p.month}${p.day}-${p.hour}${p.minute}${p.second}` };
};

export type PlanningData = {
  input: EngineInput;
  distName: Map<string, string | null>;
  completeness: number; // percent of SKU x week sales cells present over the baseline window
  enough: boolean; // completeness is at or above the rule's minimum
  windowWeeks: number;
};

/** Everything the engine needs, or a plain-English reason why it cannot run yet. */
export async function loadPlanningData(): Promise<{ ok: true; data: PlanningData } | { ok: false; message: string; completeness?: number | null; asOf?: string | null }> {
  const sql = getSql();
  const rules = await loadRules();

  const skuRows = await sql`
    select s.sku_id, s.name, s.category, s.perishability, s.std_reorder_qty, s.unit, s.distributor_id, s.hsn, s.unit_cost, s.tax_pct, d.name as distributor_name
    from skus s left join distributors d on d.distributor_id = s.distributor_id where s.active order by s.sku_id`;
  if (!skuRows.length) return { ok: false, message: "There are no SKUs in the database yet." };
  const skus: EngineSku[] = skuRows.map((r) => ({
    sku_id: String(r.sku_id), name: String(r.name), category: r.category ?? null, perishability: String(r.perishability), std_reorder_qty: Number(r.std_reorder_qty),
    distributor_id: r.distributor_id ?? null, unit: r.unit ?? null, hsn: r.hsn ?? null,
    unit_cost: r.unit_cost === null ? null : Number(r.unit_cost), tax_pct: r.tax_pct === null ? null : Number(r.tax_pct),
  }));
  const distName = new Map(skuRows.map((r) => [String(r.sku_id), (r.distributor_name as string | null) ?? null]));

  const salesRows = await sql`
    select t.sku_id, t.week, t.units from (
      select s.sku_id, s.week, s.units, row_number() over (partition by s.sku_id order by s.week desc) as rn
      from sales_weekly s join skus k on k.sku_id = s.sku_id and k.active
    ) t where t.rn <= 130`;
  if (!salesRows.length) return { ok: false, message: "There is no sales data in the database yet." };
  const weeks = [...new Set(salesRows.map((r) => String(r.week)))].sort();
  const window = weeks.slice(-rules.TREND_BASE_WEEKS);
  const inWindow = new Set(window);
  // New SKUs (too little history for the rules) go to a person as manual cards, so they must not drag completeness down.
  // "New" = started selling inside the window; a SKU that merely lost recent weeks still counts as a gap.
  const history = new Map<string, number>();
  const first = new Map<string, string>();
  for (const r of salesRows) {
    const id = String(r.sku_id), w = String(r.week);
    history.set(id, (history.get(id) ?? 0) + 1);
    if (!first.has(id) || w < first.get(id)!) first.set(id, w);
  }
  const isNew = (id: string) => (history.get(id) ?? 0) < rules.MIN_HISTORY_WEEKS && (first.get(id) ?? "") >= window[0];
  const judged = new Set(skus.filter((k) => !isNew(k.sku_id)).map((k) => k.sku_id));
  const present = salesRows.filter((r) => inWindow.has(String(r.week)) && judged.has(String(r.sku_id))).length;
  const ratio = judged.size ? present / (judged.size * window.length) : 0;
  const completeness = Math.round(ratio * 1000) / 10;

  const invRows = await sql`
    select distinct on (sku_id, location) sku_id, location, units_on_hand, as_of::text as as_of
    from inventory_snapshots order by sku_id, location, as_of desc`;
  if (!invRows.length) return { ok: false, message: "There is no stock data in the database yet.", completeness };
  const inventory: Record<string, number> = {};
  let asOf = "";
  for (const r of invRows) {
    inventory[String(r.sku_id)] = (inventory[String(r.sku_id)] ?? 0) + Number(r.units_on_hand);
    if (String(r.as_of) > asOf) asOf = String(r.as_of);
  }

  const calRows = await sql`select year_month, is_festival from calendar_months`;
  const poRows = await sql`select created_at, received_at, lines from purchase_orders where received_at is null`;
  const openDays = Number(process.env.OPEN_PO_DAYS) || 21;
  const openPos: Record<string, number> = {};
  for (const o of aggregateOpenQty(
    poRows.map((p) => ({ created_at: new Date(p.created_at).toISOString(), received_at: null, lines: (typeof p.lines === "string" ? JSON.parse(p.lines) : p.lines) as { sku: string; qty: number }[] })),
    openDays,
  )) openPos[o.sku] = o.qty_on_order;

  return {
    ok: true,
    data: {
      input: {
        sales: salesRows.map((r) => ({ sku: String(r.sku_id), week: String(r.week), units: Number(r.units) })),
        skus, inventory, openPos,
        calendar: calRows.map((c) => ({ year_month: String(c.year_month), is_festival: Boolean(c.is_festival) })),
        rules, asOf, today: istParts().date,
      },
      distName, completeness, enough: ratio >= rules.COMPLETENESS_MIN, windowWeeks: window.length,
    },
  };
}

/** Every SKU with its stock position, most urgent first. For the Stock page. */
export async function loadStock(): Promise<{ ok: true; rows: StockRow[]; asOf: string; festival: boolean; completeness: number; rules: Rules; distName: Map<string, string | null> } | { ok: false; message: string }> {
  const r = await loadPlanningData();
  if (!r.ok) return r;
  const { input, completeness, distName } = r.data;
  const festival = runEngine({ ...input, skus: [] }).festival;
  return { ok: true, rows: stockRows(input), asOf: input.asOf, festival, completeness, rules: input.rules, distName };
}

async function abort(runId: string, by: string, message: string, extra: { completeness?: number | null; asOf?: string | null } = {}): Promise<PlanningResult> {
  await getSql()`
    insert into runs (run_id, run_at, as_of, mode, status, completeness, notes, triggered_by)
    values (${runId}, now(), ${extra.asOf ?? null}, null, 'ABORTED', ${extra.completeness ?? null}, ${message}, ${by})
    on conflict (run_id) do nothing`;
  return { ok: false, runId, mode: null, flagged: 0, message };
}

export async function runPlanning(by: string, fetcher: typeof fetch = fetch): Promise<PlanningResult> {
  const sql = getSql();
  const now = istParts();
  const runId = `R${now.stamp}`;

  const loaded = await loadPlanningData();
  if (!loaded.ok) return abort(runId, by, loaded.message, { completeness: loaded.completeness });
  const { input, distName, completeness, enough, windowWeeks } = loaded.data;
  const { rules, skus, asOf } = input;
  if (!enough) {
    return abort(
      runId, by,
      `Sales data is only ${completeness}% complete over the latest ${windowWeeks} weeks (needs ${Math.round(rules.COMPLETENESS_MIN * 100)}%). Nothing was produced.`,
      { completeness },
    );
  }

  // ---- the rules
  const result: EngineResult = runEngine(input);

  // ---- Gemini words the reasons (optional); numbers are checked, template wording is the fallback
  const expl = await explainRecs(result.recs, rules, fetcher);
  for (const r of result.recs) r.reason = expl.reasons[r.sku];
  const summary = await summarizeRun(result, rules, fetcher);
  const geminiCount = result.recs.filter((r) => expl.source[r.sku] === "gemini").length;

  const mode = rules.SHADOW_MODE ? "SHADOW" : "LIVE";
  const count = (a: string) => result.recs.filter((r) => r.action === a).length;
  const notes: string[] = [];
  if (!result.recs.length) notes.push("Nothing needed attention.");
  if (result.recs.some((r) => r.dq.length)) notes.push(result.recs[0].dq.join("; "));
  if (expl.error && geminiConfigured()) notes.push(`Gemini: ${expl.error}`);

  await sql`
    insert into runs (run_id, run_at, as_of, mode, status, skus, completeness, flagged, healthy, n_reorder, n_pause, n_manual, festival,
                      gemini_reasons, summary, notes, review_due_at, triggered_by)
    values (${runId}, now(), ${asOf}, ${mode}, 'OK', ${skus.length}, ${completeness}, ${result.recs.length}, ${result.healthy},
            ${count("REORDER")}, ${count("PAUSE")}, ${count("MANUAL_REVIEW")}, ${result.festival},
            ${geminiConfigured() ? `${geminiCount}/${result.recs.length}` : null}, ${summary}, ${notes.join(" | ") || null},
            now() + (${rules.REVIEW_SLA_HOURS} * interval '1 hour'), ${by})
    on conflict (run_id) do nothing`;

  const payload = result.recs.map((r) => ({
    sku: r.sku, name: r.name, perishable: r.perishable, action: r.action, rec_qty: r.qty, priority: r.priority, on_hand: r.onHand, open_po: r.openPo,
    cover_weeks: r.coverWeeks, trend_pct: r.trendPct, flags: r.flags.join(" + "), reason: r.reason, reason_source: expl.source[r.sku],
    data_notes: r.dq.join("; "), distributor_id: r.distributor, distributor_name: distName.get(r.sku) ?? null, unit: r.unit, hsn: r.hsn,
    unit_cost: r.unitCost, tax_pct: r.taxPct,
  }));
  if (payload.length) {
    await sql`
      insert into recommendations (run_id, sku, name, perishable, action, rec_qty, priority, on_hand, open_po, cover_weeks, trend_pct, flags, reason,
                                   reason_source, data_notes, distributor_id, distributor_name, unit, hsn, unit_cost, tax_pct)
      select ${runId}, x.sku, x.name, x.perishable, x.action, x.rec_qty, x.priority, x.on_hand, x.open_po, x.cover_weeks, x.trend_pct, x.flags, x.reason,
             x.reason_source, x.data_notes, x.distributor_id, x.distributor_name, x.unit, x.hsn, x.unit_cost, x.tax_pct
      from jsonb_to_recordset(${JSON.stringify(payload)}::jsonb) as x(
        sku text, name text, perishable boolean, action text, rec_qty int, priority int, on_hand int, open_po int, cover_weeks float8, trend_pct float8,
        flags text, reason text, reason_source text, data_notes text, distributor_id text, distributor_name text, unit text, hsn text,
        unit_cost float8, tax_pct float8)
      on conflict (run_id, sku) do nothing`;
  }

  // A new live run closes whatever the previous live run left undecided, so it is counted rather than lost.
  if (mode === "LIVE") {
    await sql`
      insert into decisions (decided_at, run_id, sku, action, rec_qty, flags, priority, decision, reason, po_status)
      select now(), c.run_id, c.sku, c.action, c.rec_qty, c.flags, c.priority, 'EXPIRED', 'Not decided before the next run', 'NONE'
      from recommendations c join runs u on u.run_id = c.run_id
      where u.mode = 'LIVE' and c.run_id <> ${runId}
        and not exists (select 1 from decisions d where d.run_id = c.run_id and d.sku = c.sku)
      on conflict (run_id, sku) do nothing`;
    await generatePosForReady(); // safety net: any approval whose PO failed earlier
  }

  return {
    ok: true, runId, mode, flagged: result.recs.length,
    message: `${summary}${mode === "SHADOW" ? " (Shadow mode: logged only, nothing sent for review.)" : ""}`,
  };
}
