/**
 * Rules engine: Raghav's rules as pure functions (no Sheets, no Drive, no network).
 * Runs unchanged in Apps Script and in Node (see tests/).
 *
 * Decisions made where the brief was ambiguous (all editable in Rules_Config):
 *  - "Standard quantity"  = Standard_Reorder_Qty column in SKU_Master.
 *  - Festival uplift      = +25% on the demand used for weeks-of-cover. It is NOT applied to the
 *                           4-wk vs 12-wk trend ratio (applying it to only one side would flag every SKU).
 *                           Festival month is taken from the inventory as-of date.
 *  - Perishables (High)   = 3-4 week cover window, replacing the 6/14 week thresholds.
 *                           Reorder qty is capped so cover after the order never exceeds the perishable max.
 *  - Precedence           = one recommendation per SKU:
 *                           STOCKOUT (+/- HIGH_DEMAND)  -> REORDER (1.5x std if high-demand, else 1x)
 *                           HIGH_DEMAND alone           -> REORDER 1.5x std
 *                           OVERSTOCK alone             -> PAUSE next order
 *                           OVERSTOCK + HIGH_DEMAND     -> MANUAL_REVIEW (signals conflict, Raghav decides)
 *  - Short history        = fewer than MIN_HISTORY_WEEKS of sales -> MANUAL_REVIEW (the 15-20% judgment lane).
 *  - Priority score 0-100 = how far past its threshold the SKU is (replaces "confidence": a deterministic
 *                           rule has no probability). Perishables get a 1.25x boost.
 */

var ACTIONS = { REORDER: 'REORDER', PAUSE: 'PAUSE', MANUAL: 'MANUAL_REVIEW' };

function mean_(arr) {
  if (!arr.length) return 0;
  var s = 0;
  for (var i = 0; i < arr.length; i++) s += arr[i];
  return s / arr.length;
}

function round_(n, d) {
  var f = Math.pow(10, d || 0);
  return Math.round(n * f) / f;
}

function truthy_(v) {
  return v === true || String(v).toUpperCase() === 'TRUE';
}

/** Group sales rows ({sku, week, units}) by SKU, sorted by week ascending. */
function buildSalesIndex(rows) {
  var idx = {};
  rows.forEach(function (r) {
    var u = Number(r.units);
    if (!isFinite(u)) return;
    (idx[r.sku] = idx[r.sku] || []).push({ week: r.week, units: u });
  });
  Object.keys(idx).forEach(function (k) {
    idx[k].sort(function (a, b) { return a.week < b.week ? -1 : a.week > b.week ? 1 : 0; });
  });
  return idx;
}

/** calendar rows: {Year_Month: '2026-10', Is_Festival_Month: 'TRUE'}; asOf: 'YYYY-MM-DD'. */
function isFestivalMonth(calendarRows, asOf) {
  var key = String(asOf).slice(0, 7);
  for (var i = 0; i < calendarRows.length; i++) {
    if (calendarRows[i].Year_Month === key) return truthy_(calendarRows[i].Is_Festival_Month);
  }
  return false;
}

function daysBetween_(a, b) {
  return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
}

/**
 * Evaluate one SKU. Returns null when the SKU is healthy (no flag), otherwise a recommendation object.
 */
function evaluateSku(sku, history, onHand, openPo, festival, rules, dq) {
  var base = {
    sku: sku.SKU_ID,
    name: sku.SKU_Name,
    category: sku.Category,
    perishable: sku.Perishability === 'High',
    distributor: sku.Distributor_ID,
    unit: sku.Unit_of_Measure ? String(sku.Unit_of_Measure) : null,
    hsn: sku.HSN_Code ? String(sku.HSN_Code) : null,
    unitCost: sku.Unit_Cost === undefined || sku.Unit_Cost === '' ? null : Number(sku.Unit_Cost),
    taxPct: sku.Tax_Pct === undefined || sku.Tax_Pct === '' ? null : Number(sku.Tax_Pct),
    stdQty: Number(sku.Standard_Reorder_Qty),
    onHand: onHand,
    openPo: openPo,
    festival: festival,
    dq: dq.slice()
  };

  var units = history.map(function (h) { return h.units; });
  if (units.length < rules.MIN_HISTORY_WEEKS) {
    return Object.assign(base, {
      action: ACTIONS.MANUAL, qty: null, flags: ['SHORT_HISTORY'], priority: 50,
      avg12: null, avg4: null, trendPct: null, coverWeeks: null,
      notes: ['Only ' + units.length + ' weeks of history (need ' + rules.MIN_HISTORY_WEEKS + '): needs Raghav\'s judgment.']
    });
  }
  if (onHand === null || onHand === undefined || isNaN(onHand)) {
    return Object.assign(base, {
      action: ACTIONS.MANUAL, qty: null, flags: ['NO_INVENTORY'], priority: 50,
      avg12: null, avg4: null, trendPct: null, coverWeeks: null,
      notes: ['No inventory record for this SKU.']
    });
  }

  var avg12 = mean_(units.slice(-rules.TREND_BASE_WEEKS));
  var avg4 = mean_(units.slice(-rules.TREND_RECENT_WEEKS));
  if (avg12 <= 0) {
    return Object.assign(base, {
      action: ACTIONS.MANUAL, qty: null, flags: ['NO_SALES'], priority: 30,
      avg12: 0, avg4: avg4, trendPct: null, coverWeeks: null,
      notes: ['No sales in the last ' + rules.TREND_BASE_WEEKS + ' weeks.']
    });
  }

  var trend = avg4 / avg12 - 1;
  var demand = avg12 * (festival ? 1 + rules.FESTIVAL_UPLIFT : 1);
  var supply = onHand + (rules.USE_OPEN_POS ? openPo : 0);
  var cover = supply / demand;

  var floor = base.perishable ? rules.PERISHABLE_MIN_WEEKS : rules.STOCKOUT_WEEKS;
  var ceiling = base.perishable ? rules.PERISHABLE_MAX_WEEKS : rules.OVERSTOCK_WEEKS;

  var flags = [];
  if (cover < floor) flags.push('STOCKOUT_RISK');
  if (cover > ceiling) flags.push('OVERSTOCK_RISK');
  if (trend > rules.HIGH_DEMAND_PCT) flags.push('HIGH_DEMAND');

  var anomaly = null;
  var last = units[units.length - 1];
  if (Math.abs(last / avg12 - 1) > rules.ANOMALY_PCT) {
    anomaly = 'Latest week ' + last + ' vs 12-wk avg ' + round_(avg12, 0) + '.';
  }

  var out = Object.assign(base, {
    avg12: round_(avg12, 1), avg4: round_(avg4, 1), trendPct: round_(trend * 100, 1),
    coverWeeks: round_(cover, 1), floorWeeks: floor, ceilingWeeks: ceiling,
    flags: flags, notes: [], anomaly: anomaly
  });
  if (!flags.length) return anomaly ? Object.assign(out, { action: null, healthy: true }) : null;

  var has = function (f) { return flags.indexOf(f) >= 0; };
  var severity = 0;
  if (has('STOCKOUT_RISK')) severity = Math.max(severity, (floor - cover) / floor);
  if (has('OVERSTOCK_RISK')) severity = Math.max(severity, Math.min(1, (cover - ceiling) / ceiling));
  if (has('HIGH_DEMAND')) severity = Math.max(severity, Math.min(1, trend / 0.5));
  var priority = Math.min(100, severity * 100 * (base.perishable ? 1.25 : 1));
  out.priority = Math.max(1, Math.round(priority));

  if (has('OVERSTOCK_RISK') && has('HIGH_DEMAND')) {
    out.action = ACTIONS.MANUAL; out.qty = null;
    out.notes.push('Overstocked but sales are accelerating: signals conflict.');
  } else if (has('STOCKOUT_RISK') || has('HIGH_DEMAND')) {
    var mult = has('HIGH_DEMAND') ? rules.HIGH_DEMAND_QTY_MULT : 1;
    var qty = Math.round(out.stdQty * mult);
    if (base.perishable) {
      var cap = Math.floor(ceiling * demand - supply);
      if (cap < qty) {
        qty = Math.max(0, cap);
        out.notes.push('Qty capped so perishable stock stays within ' + ceiling + ' weeks.');
      }
    }
    out.action = ACTIONS.REORDER; out.qty = qty;
  } else {
    out.action = ACTIONS.PAUSE; out.qty = 0;
  }
  return out;
}

/**
 * input: { sales:[{sku,week,units}], skus:[...sku_master rows], inventory:{SKU:units}, openPos:{SKU:qty},
 *          calendar:[...], rules:{...}, asOf:'YYYY-MM-DD', today:'YYYY-MM-DD' (optional, for staleness) }
 */
function runEngine(input) {
  var rules = input.rules;
  var festival = isFestivalMonth(input.calendar, input.asOf);
  var idx = buildSalesIndex(input.sales);
  var dq = [];
  if (input.today && daysBetween_(input.asOf, input.today) > rules.MAX_DATA_AGE_DAYS) {
    dq.push('STALE_DATA (' + daysBetween_(input.asOf, input.today) + ' days old)');
  }
  var recs = [];
  var healthy = 0;
  var anomalies = [];
  input.skus.forEach(function (sku) {
    var rec = evaluateSku(
      sku, idx[sku.SKU_ID] || [],
      input.inventory.hasOwnProperty(sku.SKU_ID) ? Number(input.inventory[sku.SKU_ID]) : null,
      Number((input.openPos || {})[sku.SKU_ID] || 0),
      festival, rules, dq
    );
    if (!rec) { healthy++; return; }
    if (rec.anomaly) anomalies.push({ sku: rec.sku, note: rec.anomaly });
    if (rec.healthy) { healthy++; return; }
    rec.reason = templateReason(rec, rules);
    recs.push(rec);
  });
  recs.sort(function (a, b) { return b.priority - a.priority; });
  return {
    recs: recs, healthy: healthy, festival: festival, anomalies: anomalies, asOf: input.asOf,
    skuCount: input.skus.length
  };
}

/** Deterministic plain-English reason. Used as the fallback whenever Gemini is unavailable or fails validation. */
function templateReason(rec, rules) {
  if (rec.flags.indexOf('SHORT_HISTORY') >= 0 || rec.flags.indexOf('NO_INVENTORY') >= 0 || rec.flags.indexOf('NO_SALES') >= 0) {
    return rec.notes[0];
  }
  var parts = [];
  var uplift = rec.festival ? ' (festival +' + Math.round(rules.FESTIVAL_UPLIFT * 100) + '% applied)' : '';
  if (rec.flags.indexOf('STOCKOUT_RISK') >= 0) {
    parts.push('Stock covers ' + rec.coverWeeks + ' weeks' + uplift + ', below the ' + rec.floorWeeks + '-week floor.');
  }
  if (rec.flags.indexOf('OVERSTOCK_RISK') >= 0) {
    parts.push('Stock covers ' + rec.coverWeeks + ' weeks' + uplift + ', above the ' + rec.ceilingWeeks + '-week ceiling.');
  }
  if (rec.flags.indexOf('HIGH_DEMAND') >= 0) {
    parts.push('Last 4 weeks sold ' + rec.trendPct + '% above the 12-week average.');
  }
  return parts.concat(rec.notes).join(' ');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ACTIONS: ACTIONS, buildSalesIndex: buildSalesIndex, isFestivalMonth: isFestivalMonth,
    evaluateSku: evaluateSku, runEngine: runEngine, templateReason: templateReason
  };
}
