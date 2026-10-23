/** Shared constants, the default rules table and small Sheets helpers. */

var SHEETS = {
  RULES: 'Rules_Config', SALES: 'Sales', SKU: 'SKU_Master', INV: 'Inventory', INV_HIST: 'Inventory_History',
  CAL: 'Calendar', DIST: 'Distributors', PO: 'Open_POs',
  REVIEW: 'Review', APPROVED: 'Approved', REJECTIONS: 'Rejections', DECISIONS: 'Decision_Log',
  SHADOW: 'Shadow_Log', RULE_REVIEW: 'Rule_Review', RUNS: 'Run_Log', METRICS: 'Metrics'
};

/** [key, value, description]. Raghav's five rules plus the knobs the build decisions turned into config. */
var DEFAULT_RULES = [
  ['HIGH_DEMAND_PCT', 0.20, 'Rule 1: flag high-demand when 4-wk sales exceed the 12-wk average by more than this'],
  ['HIGH_DEMAND_QTY_MULT', 1.5, 'Rule 1: reorder this multiple of the standard quantity (Standard_Reorder_Qty in SKU_Master)'],
  ['STOCKOUT_WEEKS', 6, 'Rule 2: stockout risk when weeks of cover is below this (non-perishable)'],
  ['OVERSTOCK_WEEKS', 14, 'Rule 3: overstock risk when weeks of cover is above this (non-perishable)'],
  ['FESTIVAL_UPLIFT', 0.25, 'Rule 4: demand uplift in festival months (Calendar tab), applied to the demand used for weeks of cover'],
  ['PERISHABLE_MIN_WEEKS', 3, 'Rule 5: high-perishability minimum weeks of stock (replaces STOCKOUT_WEEKS)'],
  ['PERISHABLE_MAX_WEEKS', 4, 'Rule 5: high-perishability maximum weeks of stock (replaces OVERSTOCK_WEEKS, also caps reorder qty)'],
  ['TREND_RECENT_WEEKS', 4, 'Weeks in the recent-sales window'],
  ['TREND_BASE_WEEKS', 12, 'Weeks in the baseline-average window'],
  ['MIN_HISTORY_WEEKS', 12, 'SKUs with less history go to Raghav as MANUAL_REVIEW (new launches)'],
  ['USE_OPEN_POS', true, 'Count open/in-transit POs (Open_POs tab) as stock so flags do not re-order what is already placed'],
  ['SHADOW_MODE', true, 'TRUE = log recommendations to Shadow_Log only (first 4 weeks). FALSE = send to Review'],
  ['COMPLETENESS_MIN', 0.95, 'Kill gate: abort the run if sales completeness is below this'],
  ['MAX_DATA_AGE_DAYS', 4, 'Warn when inventory as-of date is older than this'],
  ['ANOMALY_PCT', 0.35, 'Mention an anomaly when the latest week deviates from the 12-wk average by more than this'],
  ['REVIEW_SLA_HOURS', 24, 'Hours Raghav has to decide before the backup approver is nudged'],
  ['OVERRIDE_ALERT_COUNT', 3, 'Open a Rule_Review item when a rule is overridden/rejected this many times...'],
  ['OVERRIDE_ALERT_DAYS', 28, '...within this many days'],
  ['ADOPTION_KILL_PCT', 0.40, 'Kill criterion: overall override+reject rate above this for 4 weeks means the rules do not reflect Raghav']
];

function defaultRulesObject_() {
  var o = {};
  DEFAULT_RULES.forEach(function (r) { o[r[0]] = r[1]; });
  return o;
}

function readRules_() {
  var rules = defaultRulesObject_();
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEETS.RULES);
  if (!sh || sh.getLastRow() < 2) return rules;
  sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(function (row) {
    var k = String(row[0]).trim();
    if (!k || !rules.hasOwnProperty(k)) return;
    var v = row[1];
    rules[k] = typeof rules[k] === 'boolean' ? truthy_(v) : Number(v);
  });
  return rules;
}

function prop_(key) {
  return PropertiesService.getScriptProperties().getProperty(key) || '';
}

function getOrCreateSheet_(name) {
  var ss = SpreadsheetApp.getActive();
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

/** Read a tab as an array of objects keyed by its header row. */
function readTable_(name) {
  var sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  var vals = sh.getDataRange().getValues();
  var head = vals[0];
  return vals.slice(1).map(function (r) {
    var o = {};
    head.forEach(function (h, i) { o[h] = r[i]; });
    return o;
  });
}

/**
 * Clear a tab and write header + rows. textCols (1-based) are forced to plain text so Sheets does not
 * turn '2026-10' or '2026-10-19' into dates.
 */
function writeTable_(name, header, rows, textCols) {
  var sh = getOrCreateSheet_(name);
  sh.clear();
  sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold').setBackground('#14213d').setFontColor('#ffffff');
  if (rows.length) {
    (textCols || []).forEach(function (c) { sh.getRange(2, c, rows.length, 1).setNumberFormat('@'); });
    sh.getRange(2, 1, rows.length, header.length).setValues(rows);
  }
  sh.setFrozenRows(1);
  return sh;
}

function appendRows_(name, header, rows, textCols) {
  if (!rows.length) return;
  var sh = getOrCreateSheet_(name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold').setBackground('#14213d').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  var start = sh.getLastRow() + 1;
  (textCols || []).forEach(function (c) { sh.getRange(start, c, rows.length, 1).setNumberFormat('@'); });
  sh.getRange(start, 1, rows.length, header.length).setValues(rows);
}

function todayIso_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DEFAULT_RULES: DEFAULT_RULES, defaultRulesObject_: defaultRulesObject_ };
}
