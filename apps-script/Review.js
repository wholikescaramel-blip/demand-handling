/**
 * The human gate. Nothing reaches the Approved tab (and so procurement) without a decision from Raghav.
 * Reject and Override need a reason: that is the kill switch and it feeds the feedback loop.
 */

var REVIEW_HEADER = [
  'Run ID', 'SKU', 'Name', 'Perishable', 'Action', 'Rec Qty', 'Priority', 'On hand', 'Open PO', 'Cover (wks)',
  'Trend %', 'Flags', 'Reason', 'Data notes', 'Due by',
  'Decision', 'Override Qty', 'Reason for change', 'Status'
];
var DECISION_HEADER = [
  'Decided at', 'Run ID', 'SKU', 'Action', 'Rec Qty', 'Flags', 'Priority', 'Decision', 'Final Qty',
  'Reason for change', 'Reviewer', 'Hours to decide'
];
var APPROVED_HEADER = ['Approved at', 'Run ID', 'SKU', 'Name', 'Action', 'Final Qty', 'Note', 'Reviewer', 'PO number', 'PO placed on'];
var REJECTION_HEADER = ['Rejected at', 'Run ID', 'SKU', 'Rule flags', 'Rec Qty', 'Reason', 'Reviewer'];
var SHADOW_HEADER = ['Run ID', 'Run at', 'As of', 'SKU', 'Name', 'Action', 'Rec Qty', 'Priority', 'Cover (wks)', 'Trend %', 'Flags', 'Reason'];

function col_(name) { return REVIEW_HEADER.indexOf(name) + 1; }

function fmtDate_(d) { return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm'); }

/** Anything still PENDING from an earlier run is closed as EXPIRED so it is counted, not silently lost. */
function expirePending_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEETS.REVIEW);
  if (!sh || sh.getLastRow() < 2) return 0;
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, REVIEW_HEADER.length).getValues();
  var now = fmtDate_(new Date());
  var rows = [];
  var dash = [];
  vals.forEach(function (r) {
    if (r[col_('Status') - 1] === 'PENDING' || String(r[col_('Status') - 1]).indexOf('ERROR') === 0) {
      rows.push([now, r[0], r[1], r[col_('Action') - 1], r[col_('Rec Qty') - 1], r[col_('Flags') - 1], r[col_('Priority') - 1],
        'EXPIRED', '', 'Not decided before the next run', '', '']);
      var q = r[col_('Rec Qty') - 1];
      dash.push({
        decided_at: isoNow_(new Date()), run_id: String(r[0]), sku: String(r[1]), action: String(r[col_('Action') - 1]),
        rec_qty: q === '' ? null : Number(q), flags: String(r[col_('Flags') - 1]), priority: Number(r[col_('Priority') - 1]),
        decision: 'EXPIRED', final_qty: null, reason: 'Not decided before the next run', reviewer: null, hours_to_decide: null
      });
    }
  });
  appendRows_(SHEETS.DECISIONS, DECISION_HEADER, rows, [1]);
  if (dash.length) pushToDashboard_({ type: 'decisions', decisions: dash });
  return rows.length;
}

function recToReviewRow_(runId, rec, due) {
  return [
    runId, rec.sku, rec.name, rec.perishable ? 'High' : 'Low', rec.action, rec.qty === null ? '' : rec.qty, rec.priority,
    rec.onHand, rec.openPo, rec.coverWeeks === null ? '' : rec.coverWeeks, rec.trendPct === null ? '' : rec.trendPct,
    rec.flags.join(' + '), rec.reason, rec.dq.join('; '), due, '', '', '', 'PENDING'
  ];
}

function writeReview_(runId, recs, rules) {
  var expired = expirePending_();
  var due = fmtDate_(new Date(Date.now() + rules.REVIEW_SLA_HOURS * 3600 * 1000));
  var rows = recs.map(function (r) { return recToReviewRow_(runId, r, due); });
  var sh = writeTable_(SHEETS.REVIEW, REVIEW_HEADER, rows, [15]);
  if (rows.length) {
    var n = rows.length;
    sh.getRange(2, col_('Decision'), n, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(['Approve', 'Reject', 'Override'], true).setAllowInvalid(false).build());
    sh.getRange(2, col_('Decision'), n, 3).setBackground('#fff4df');
    sh.getRange(2, col_('Reason'), n, 1).setWrap(true);
    sh.setColumnWidth(col_('Reason'), 380);
  }
  return expired;
}

function writeShadow_(runId, result, recs) {
  var now = fmtDate_(new Date());
  var rows = recs.map(function (r) {
    return [runId, now, result.asOf, r.sku, r.name, r.action, r.qty === null ? '' : r.qty, r.priority,
      r.coverWeeks === null ? '' : r.coverWeeks, r.trendPct === null ? '' : r.trendPct, r.flags.join(' + '), r.reason];
  });
  appendRows_(SHEETS.SHADOW, SHADOW_HEADER, rows, [2, 3]);
}

/**
 * Menu: "Finalise decisions". Validates every decided row, then:
 *   Approve / Override -> Approved tab, Reject -> Rejections tab, all -> Decision_Log.
 */
function finaliseReview() {
  var ui = SpreadsheetApp.getUi();
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEETS.REVIEW);
  if (!sh || sh.getLastRow() < 2) { ui.alert('Nothing in Review.'); return; }
  var n = sh.getLastRow() - 1;
  var vals = sh.getRange(2, 1, n, REVIEW_HEADER.length).getValues();
  var reviewer = Session.getActiveUser().getEmail() || 'unknown';
  var now = new Date();
  var approved = [], rejected = [], decisions = [], dash = [];
  var errors = 0, done = 0;
  var rules = readRules_();

  vals.forEach(function (r, i) {
    var status = r[col_('Status') - 1];
    var decision = r[col_('Decision') - 1];
    if (status !== 'PENDING' && String(status).indexOf('ERROR') !== 0) return;
    if (!decision) return;

    var action = r[col_('Action') - 1];
    var recQty = r[col_('Rec Qty') - 1];
    var why = String(r[col_('Reason for change') - 1] || '').trim();
    var ovr = r[col_('Override Qty') - 1];
    var problem = '';
    if (decision === 'Reject' && !why) problem = 'Reject needs a reason';
    else if (decision === 'Override' && (ovr === '' || isNaN(Number(ovr)) || Number(ovr) < 0)) problem = 'Override needs a quantity (0 or more)';
    else if (decision === 'Override' && !why) problem = 'Override needs a reason';
    else if (decision === 'Approve' && action === ACTIONS.MANUAL) problem = 'Manual-review rows cannot be approved as is: Override with a quantity, or Reject';
    if (problem) {
      sh.getRange(i + 2, col_('Status')).setValue('ERROR: ' + problem).setBackground('#f8c9c9');
      errors++;
      return;
    }

    var finalQty = decision === 'Reject' ? '' : decision === 'Override' ? Number(ovr) : (recQty === '' ? 0 : recQty);
    var dueStr = String(r[col_('Due by') - 1]);
    var runAt = new Date(dueStr.replace(' ', 'T') + ':00');
    var hours = isNaN(runAt) ? '' : Math.round(((now - runAt) / 3600000 + rules.REVIEW_SLA_HOURS) * 10) / 10;
    var stamp = fmtDate_(now);

    decisions.push([stamp, r[0], r[1], action, recQty, r[col_('Flags') - 1], r[col_('Priority') - 1], decision, finalQty, why, reviewer, hours]);
    dash.push({
      decided_at: isoNow_(now), run_id: String(r[0]), sku: String(r[1]), action: String(action),
      rec_qty: recQty === '' ? null : Number(recQty), flags: String(r[col_('Flags') - 1]), priority: Number(r[col_('Priority') - 1]),
      decision: decision, final_qty: finalQty === '' ? null : Number(finalQty), reason: why || null, reviewer: reviewer,
      hours_to_decide: hours === '' ? null : hours
    });
    if (decision === 'Reject') {
      rejected.push([stamp, r[0], r[1], r[col_('Flags') - 1], recQty, why, reviewer]);
    } else {
      var note = decision === 'Override' ? 'Overridden: ' + why : (action === ACTIONS.PAUSE ? 'Pause the next order' : '');
      approved.push([stamp, r[0], r[1], r[2], action, finalQty, note, reviewer, '', '']);
    }
    sh.getRange(i + 2, col_('Status')).setValue('DONE').setBackground('#d9f2e0');
    done++;
  });

  appendRows_(SHEETS.DECISIONS, DECISION_HEADER, decisions, [1]);
  appendRows_(SHEETS.APPROVED, APPROVED_HEADER, approved, [1, 10]);
  appendRows_(SHEETS.REJECTIONS, REJECTION_HEADER, rejected, [1]);
  var pushed = dash.length ? pushToDashboard_({ type: 'decisions', decisions: dash }) : { skipped: true };
  if (done) { evaluateRuleFeedback_(rules); notifyProcurement_(approved.length); }
  ui.alert(done + ' decision(s) recorded (' + approved.length + ' approved/overridden, ' + rejected.length + ' rejected).' +
    (errors ? '\n' + errors + ' row(s) need fixing: see the red Status cells.' : '') +
    (pushed.ok === false ? '\n\nDashboard not updated: ' + pushed.error + '\nUse Demand Planning > Sync to dashboard to retry.' : ''));
}

function notifyProcurement_(count) {
  var to = prop_('PROCUREMENT_EMAIL');
  if (!to || !count) return;
  MailApp.sendEmail(to, 'Approved demand-planning list: ' + count + ' SKU(s)',
    'Raghav has approved ' + count + ' recommendation(s). Create the purchase orders and record each PO number in the Approved tab.\n\n' +
    SpreadsheetApp.getActive().getUrl());
}

/** Daily trigger: nudge Raghav and the backup approver when a decision is past its 24h due time. */
function checkSla() {
  if (dashboardMode_()) { checkSlaDashboard_(); return; }
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEETS.REVIEW);
  if (!sh || sh.getLastRow() < 2) return;
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, REVIEW_HEADER.length).getValues();
  var overdue = vals.filter(function (r) {
    if (r[col_('Status') - 1] !== 'PENDING' || r[col_('Decision') - 1]) return false;
    var due = new Date(String(r[col_('Due by') - 1]).replace(' ', 'T') + ':00');
    return !isNaN(due) && due < new Date();
  });
  if (!overdue.length) return;
  var to = [prop_('REVIEWER_EMAIL'), prop_('BACKUP_EMAIL')].filter(String).join(',');
  if (!to) return;
  MailApp.sendEmail(to, overdue.length + ' demand-planning decision(s) overdue',
    overdue.length + ' flagged SKU(s) have passed the review deadline. If Raghav is away, the backup approver should decide.\n\n' +
    SpreadsheetApp.getActive().getUrl());
}

/**
 * After each finalise: a rule (flag) overridden/rejected OVERRIDE_ALERT_COUNT+ times in OVERRIDE_ALERT_DAYS opens a
 * Rule_Review item. Also records the overall override rate against the 40% adoption kill criterion.
 * Rules never change themselves: a human edits Rules_Config.
 */
function evaluateRuleFeedback_(rules) {
  var log = readTable_(SHEETS.DECISIONS);
  var cutoff = Date.now() - rules.OVERRIDE_ALERT_DAYS * 86400000;
  var recent = log.filter(function (d) {
    var t = new Date(String(d['Decided at']).replace(' ', 'T') + ':00').getTime();
    return !isNaN(t) && t >= cutoff && d.Decision !== 'EXPIRED';
  });
  var byRule = {};
  recent.forEach(function (d) {
    String(d.Flags).split(' + ').forEach(function (f) {
      if (!f) return;
      byRule[f] = byRule[f] || { total: 0, changed: 0 };
      byRule[f].total++;
      if (d.Decision === 'Override' || d.Decision === 'Reject') byRule[f].changed++;
    });
  });
  var header = ['Opened', 'Rule', 'Overridden/rejected', 'Decisions', 'Rate', 'Next step', 'Gemini proposal', 'Status'];
  var existing = readTable_(SHEETS.RULE_REVIEW);
  var open = {};
  existing.forEach(function (e) { if (e.Status === 'OPEN') open[e.Rule] = true; });
  var rows = [];
  Object.keys(byRule).forEach(function (rule) {
    var b = byRule[rule];
    if (b.changed >= rules.OVERRIDE_ALERT_COUNT && !open[rule]) {
      rows.push([fmtDate_(new Date()), rule, b.changed, b.total, Math.round(b.changed / b.total * 100) + '%',
        'Raghav + Deepa review this rule. Edit Rules_Config only after both approve.', '', 'OPEN']);
    }
  });
  appendRows_(SHEETS.RULE_REVIEW, header, rows, [1]);
  if (rows.length) syncRuleReviews_();

  var total = recent.length;
  var changed = recent.filter(function (d) { return d.Decision === 'Override' || d.Decision === 'Reject'; }).length;
  if (total >= 10 && changed / total > rules.ADOPTION_KILL_PCT) {
    SpreadsheetApp.getActive().toast('Override+reject rate is ' + Math.round(changed / total * 100) + '% over ' + rules.OVERRIDE_ALERT_DAYS +
      ' days: above the ' + rules.ADOPTION_KILL_PCT * 100 + '% adoption kill line.', 'Adoption warning', 15);
  }
}

/** Menu: ask Gemini to draft a proposal for each OPEN Rule_Review item. A proposal is text only. */
function proposeRuleChanges() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEETS.RULE_REVIEW);
  if (!sh || sh.getLastRow() < 2) { SpreadsheetApp.getUi().alert('No Rule_Review items.'); return; }
  var log = readTable_(SHEETS.DECISIONS);
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, 8).getValues();
  var made = 0;
  vals.forEach(function (r, i) {
    if (r[7] !== 'OPEN' || r[6]) return;
    var reasons = log.filter(function (d) {
      return String(d.Flags).indexOf(r[1]) >= 0 && (d.Decision === 'Override' || d.Decision === 'Reject') && d['Reason for change'];
    }).map(function (d) { return d['Reason for change']; });
    var text = proposeRuleText_(r[1], reasons, r[2], r[3]);
    if (text) { sh.getRange(i + 2, 7).setValue(text).setWrap(true); made++; }
  });
  if (made) syncRuleReviews_();
  SpreadsheetApp.getUi().alert(made + ' proposal(s) written. They are suggestions only: edit Rules_Config after Raghav and Deepa approve.');
}

/** Dashboard mode: ask the dashboard whether decisions are overdue, then nudge Raghav and the backup approver. */
function checkSlaDashboard_() {
  var r = dashboardGet_('/api/status');
  if (!r.ok || !r.json.overdue) return;
  var to = [prop_('REVIEWER_EMAIL'), prop_('BACKUP_EMAIL')].filter(String).join(',');
  if (!to) return;
  MailApp.sendEmail(to, r.json.pending + ' demand-planning decision(s) overdue',
    r.json.pending + ' flagged SKU(s) have passed the review deadline. If Raghav is away, the backup approver should decide.\n\n' +
    prop_('DASHBOARD_URL').replace(/\/+$/, '') + '/review');
}
