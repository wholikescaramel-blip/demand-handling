/**
 * Push to the web dashboard (Vercel + Neon). Optional: does nothing until DASHBOARD_URL and SYNC_SECRET are set.
 * The Sheet stays the system of record; a failed push never breaks a run, it is reported in Run_Log notes.
 */

function isoNow_(d) {
  return Utilities.formatDate(d || new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ssXXX");
}

/** 'yyyy-MM-dd HH:mm' (as written to the Sheet) -> ISO with the script time zone offset. */
function sheetStampToIso_(s) {
  var offset = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'XXX');
  return String(s).replace(' ', 'T') + ':00' + offset;
}

/** Returns {skipped:true} | {ok:true} | {ok:false, error}. */
function pushToDashboard_(payload) {
  var url = prop_('DASHBOARD_URL');
  var secret = prop_('SYNC_SECRET');
  if (!url || !secret) return { skipped: true };
  try {
    var resp = UrlFetchApp.fetch(url.replace(/\/+$/, '') + '/api/ingest', {
      method: 'post', contentType: 'application/json', headers: { 'x-sync-secret': secret },
      payload: JSON.stringify(payload), muteHttpExceptions: true
    });
    if (resp.getResponseCode() !== 200) return { ok: false, error: 'dashboard HTTP ' + resp.getResponseCode() + ': ' + resp.getContentText().slice(0, 150) };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: 'dashboard: ' + String(e.message || e).slice(0, 150) };
  }
}

function recForDashboard_(rec, source, distNames) {
  return {
    sku: rec.sku, name: rec.name, perishable: rec.perishable, action: rec.action,
    rec_qty: rec.qty === null ? null : rec.qty, priority: rec.priority, on_hand: rec.onHand, open_po: rec.openPo,
    cover_weeks: rec.coverWeeks, trend_pct: rec.trendPct, flags: rec.flags.join(' + '),
    reason: rec.reason, reason_source: source || 'template', data_notes: rec.dq.join('; '),
    distributor_id: rec.distributor || null, distributor_name: (distNames || {})[rec.distributor] || null
  };
}

function decisionRowToDashboard_(r) {
  var num = function (v) { return v === '' || v === null || v === undefined || isNaN(Number(v)) ? null : Number(v); };
  return {
    decided_at: sheetStampToIso_(r['Decided at']), run_id: String(r['Run ID']), sku: String(r.SKU), action: r.Action ? String(r.Action) : null,
    rec_qty: num(r['Rec Qty']), flags: r.Flags ? String(r.Flags) : null, priority: num(r.Priority), decision: String(r.Decision),
    final_qty: num(r['Final Qty']), reason: r['Reason for change'] ? String(r['Reason for change']) : null,
    reviewer: r.Reviewer ? String(r.Reviewer) : null, hours_to_decide: num(r['Hours to decide'])
  };
}

/** Push every Rule_Review row (small table). Status changes made by hand in the Sheet go out with the next call. */
function syncRuleReviews_() {
  var items = readTable_(SHEETS.RULE_REVIEW).map(function (r) {
    return {
      opened_at: sheetStampToIso_(r.Opened), rule: String(r.Rule), changed: Number(r['Overridden/rejected']) || 0,
      total: Number(r.Decisions) || 0, rate: String(r.Rate), proposal: r['Gemini proposal'] ? String(r['Gemini proposal']) : null,
      status: String(r.Status || 'OPEN')
    };
  });
  if (!items.length) return { skipped: true };
  return pushToDashboard_({ type: 'rule_reviews', items: items });
}

/** Menu: back-fill the dashboard from Decision_Log and Rule_Review (use after connecting the dashboard late). */
function syncAllToDashboard() {
  var ui = SpreadsheetApp.getUi();
  if (!prop_('DASHBOARD_URL') || !prop_('SYNC_SECRET')) { ui.alert('Set DASHBOARD_URL and SYNC_SECRET first (Configure).'); return; }
  var decisions = readTable_(SHEETS.DECISIONS).map(decisionRowToDashboard_);
  var out = [];
  for (var i = 0; i < decisions.length; i += 100) {
    var r = pushToDashboard_({ type: 'decisions', decisions: decisions.slice(i, i + 100) });
    if (r.ok === false) { ui.alert('Sync failed: ' + r.error); return; }
  }
  var rr = syncRuleReviews_();
  ui.alert('Synced ' + decisions.length + ' decision(s)' + (rr.ok === false ? '. Rule reviews failed: ' + rr.error : ' and the rule review queue.') +
    '\n\nRuns sync automatically at the end of each pipeline run.');
}

/** True when review happens in the web dashboard (Raghav approves there, POs go to Zoho from there). */
function dashboardMode_() {
  return Boolean(prop_('DASHBOARD_URL') && prop_('SYNC_SECRET'));
}

function dashboardGet_(path) {
  try {
    var resp = UrlFetchApp.fetch(prop_('DASHBOARD_URL').replace(/\/+$/, '') + path, {
      method: 'get', headers: { 'x-sync-secret': prop_('SYNC_SECRET') }, muteHttpExceptions: true
    });
    var body = resp.getContentText();
    if (resp.getResponseCode() !== 200) return { ok: false, error: 'dashboard HTTP ' + resp.getResponseCode() + ': ' + body.slice(0, 150) };
    return { ok: true, json: JSON.parse(body) };
  } catch (e) {
    return { ok: false, error: 'dashboard: ' + String(e.message || e).slice(0, 150) };
  }
}

/**
 * Stock already on order, read from Zoho through the dashboard (Zoho credentials stay there).
 * Overwrites the Open_POs tab. If Zoho is not configured or the call fails, the CSV feed stays in place.
 * Returns a note for Run_Log, or '' when there is nothing to say.
 */
function pullOpenPos_() {
  if (!dashboardMode_()) return '';
  var r = dashboardGet_('/api/open-pos');
  if (!r.ok) return 'Open POs from Zoho unavailable: ' + r.error;
  if (!r.json.configured) return '';
  var items = r.json.items || [];
  writeTable_(SHEETS.PO, ['SKU_ID', 'Qty_On_Order', 'Expected_Date'],
    items.map(function (i) { return [i.sku, i.qty_on_order, i.expected_date || '']; }), [3]);
  return 'Open POs from Zoho: ' + items.length + ' SKU(s) on order';
}

/**
 * Mirror the dashboard's decisions and PO numbers into Decision_Log / Approved / Rejections, so the Sheet stays the
 * system of record and the override feedback loop keeps working. Idempotent: rows are keyed by run + SKU.
 * Returns {ok, added, updated} or {ok:false, error}.
 */
function pullDecisions_() {
  if (!dashboardMode_()) return { ok: true, added: 0, updated: 0, skipped: true };
  var r = dashboardGet_('/api/decisions?days=90');
  if (!r.ok) return r;

  var have = {};
  readTable_(SHEETS.DECISIONS).forEach(function (d) { have[String(d['Run ID']) + '|' + String(d.SKU)] = true; });

  var logRows = [], approved = [], rejected = [];
  (r.json.decisions || []).forEach(function (d) {
    if (have[d.run_id + '|' + d.sku]) return;
    var stamp = fmtDate_(new Date(d.decided_at));
    var recQty = d.rec_qty === null ? '' : d.rec_qty;
    var finalQty = d.final_qty === null ? '' : d.final_qty;
    logRows.push([stamp, d.run_id, d.sku, d.action || '', recQty, d.flags || '', d.priority === null ? '' : d.priority, d.decision,
      finalQty, d.reason || '', d.reviewer || '', d.hours_to_decide === null ? '' : d.hours_to_decide]);
    if (d.decision === 'Reject') {
      rejected.push([stamp, d.run_id, d.sku, d.flags || '', recQty, d.reason || '', d.reviewer || '']);
    } else if (d.decision === 'Approve' || d.decision === 'Override') {
      var note = d.decision === 'Override' ? 'Overridden: ' + (d.reason || '') : (d.action === ACTIONS.PAUSE ? 'Pause the next order' : '');
      approved.push([stamp, d.run_id, d.sku, d.name || '', d.action || '', finalQty, note, d.reviewer || '',
        d.po_number || '', d.po_created_at ? fmtDate_(new Date(d.po_created_at)) : '']);
    }
  });
  appendRows_(SHEETS.DECISIONS, DECISION_HEADER, logRows, [1]);
  appendRows_(SHEETS.APPROVED, APPROVED_HEADER, approved, [1, 10]);
  appendRows_(SHEETS.REJECTIONS, REJECTION_HEADER, rejected, [1]);

  // PO numbers arrive after the decision (POs are created in a batch), so fill them into existing Approved rows.
  var updated = 0;
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEETS.APPROVED);
  if (sh && sh.getLastRow() > 1) {
    var vals = sh.getRange(2, 1, sh.getLastRow() - 1, APPROVED_HEADER.length).getValues();
    var byKey = {};
    vals.forEach(function (row, i) { byKey[String(row[1]) + '|' + String(row[2])] = i; });
    (r.json.decisions || []).forEach(function (d) {
      var i = byKey[d.run_id + '|' + d.sku];
      if (i === undefined || !d.po_number || vals[i][8]) return;
      sh.getRange(i + 2, 9, 1, 2).setValues([[d.po_number, d.po_created_at ? fmtDate_(new Date(d.po_created_at)) : '']]);
      updated++;
    });
  }
  if (logRows.length) evaluateRuleFeedback_(readRules_());
  return { ok: true, added: logRows.length, updated: updated };
}

/** Trigger (every 6 hours) and menu entry. */
function pullDecisions() {
  var r = pullDecisions_();
  if (r.ok === false) appendRows_(SHEETS.RUNS, RUN_HEADER, [['PULL', fmtDate_(new Date()), '', '', '', '', '', '', '', '', '', 'PULL FAILED', r.error]], [2]);
  return r;
}

function pullDecisionsFromMenu() {
  var ui = SpreadsheetApp.getUi();
  if (!dashboardMode_()) { ui.alert('Set DASHBOARD_URL and SYNC_SECRET first (Configure).'); return; }
  var r = pullDecisions_();
  ui.alert(r.ok === false ? 'Could not reach the dashboard: ' + r.error : 'Pulled ' + r.added + ' new decision(s); filled ' + r.updated + ' PO number(s).');
}
