/** Pipeline entry points: trigger, menu and the run log. */

var RUN_HEADER = ['Run ID', 'Run at', 'As of', 'Mode', 'SKUs', 'Completeness %', 'Flagged', 'Healthy', 'Festival month',
  'Reasons by Gemini', 'Gemini tokens', 'Summary', 'Warnings / errors'];

/** Time-driven (Tue + Fri) and menu. Ingest -> rules -> Gemini explanations -> Review (or Shadow_Log). */
function runPipeline() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  var runId = 'R' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmm');
  var now = fmtDate_(new Date());
  try {
    var rules = readRules_();
    var mode = rules.SHADOW_MODE ? 'SHADOW' : 'LIVE';
    var pulled = pullDecisions_();
    var ing = ingest_(rules);
    if (!ing.ok) {
      appendRows_(SHEETS.RUNS, RUN_HEADER, [[runId, now, ing.asOf || '', mode, '', ing.stats.completeness || '', '', '', '', '', '', 'ABORTED', ing.errors.concat(ing.warnings).join(' | ')]], [2, 3]);
      pushToDashboard_({
        type: 'run',
        run: {
          run_id: runId, run_at: isoNow_(new Date()), as_of: ing.asOf, mode: mode, status: 'ABORTED',
          completeness: ing.stats.completeness === undefined ? null : ing.stats.completeness, notes: ing.errors.join(' | ')
        },
        recs: []
      });
      alertOwners_('Demand planning run aborted', ing.errors.join('\n'));
      return ing;
    }

    var poNote = pullOpenPos_();
    var result = runEngine(readEngineInput_(rules, ing.asOf));
    var expl = explainRecs_(result.recs, rules);
    result.recs.forEach(function (r) { r.reason = expl.reasons[r.sku]; });
    var summary = summarizeRun_(result, rules);

    var expired = 0;
    var inDashboard = dashboardMode_();
    if (rules.SHADOW_MODE) writeShadow_(runId, result, result.recs);
    else if (!inDashboard) expired = writeReview_(runId, result.recs, rules);

    var geminiCount = result.recs.filter(function (r) { return expl.source[r.sku] === 'gemini'; }).length;
    var notes = ing.warnings.slice();
    if (poNote) notes.push(poNote);
    if (pulled.ok === false) notes.push('Decisions not pulled: ' + pulled.error);
    if (expl.error) notes.push('Gemini: ' + expl.error);
    if (expired) notes.push(expired + ' undecided row(s) from the previous run marked EXPIRED');

    var distNames = {};
    var vendors = [];
    readTable_(SHEETS.DIST).forEach(function (d) {
      distNames[d.Distributor_ID] = d.Distributor_Name;
      vendors.push({
        key: String(d.Distributor_ID), name: d.Distributor_Name || null, region: d.Region || null, address: d.Address || null,
        gstin: d.GSTIN || null, contact: d.Contact ? String(d.Contact) : null, email: d.Email || null
      });
    });
    var countAction = function (a) { return result.recs.filter(function (r) { return r.action === a; }).length; };
    var push = pushToDashboard_({
      type: 'run',
      run: {
        run_id: runId, run_at: isoNow_(new Date()), as_of: ing.asOf, mode: mode, status: 'OK', skus: result.skuCount,
        completeness: ing.stats.completeness, flagged: result.recs.length, healthy: result.healthy,
        n_reorder: countAction(ACTIONS.REORDER), n_pause: countAction(ACTIONS.PAUSE), n_manual: countAction(ACTIONS.MANUAL),
        festival: result.festival, gemini_reasons: geminiCount + '/' + result.recs.length,
        gemini_tokens: expl.tokens + summary.tokens, summary: summary.text, notes: notes.join(' | '),
        review_due_at: isoNow_(new Date(Date.now() + rules.REVIEW_SLA_HOURS * 3600 * 1000))
      },
      recs: result.recs.map(function (r) { return recForDashboard_(r, expl.source[r.sku], distNames); }),
      vendors: vendors
    });
    if (push.ok === false) notes.push(push.error);
    appendRows_(SHEETS.RUNS, RUN_HEADER, [[runId, now, ing.asOf, mode, result.skuCount, ing.stats.completeness, result.recs.length,
      result.healthy, result.festival ? 'YES' : 'no', geminiCount + '/' + result.recs.length, expl.tokens + summary.tokens,
      summary.text, notes.join(' | ')]], [2, 3]);

    if (!rules.SHADOW_MODE && result.recs.length) {
      var to = prop_('REVIEWER_EMAIL');
      if (to) MailApp.sendEmail(to, 'Demand planning: ' + result.recs.length + ' SKU(s) to review',
        summary.text + '\n\nDecide within ' + rules.REVIEW_SLA_HOURS + ' hours:\n' + (inDashboard ? prop_('DASHBOARD_URL').replace(/\/+$/, '') + '/review' : SpreadsheetApp.getActive().getUrl()));
    }
    return { runId: runId, flagged: result.recs.length, mode: mode, summary: summary.text };
  } catch (e) {
    appendRows_(SHEETS.RUNS, RUN_HEADER, [[runId, now, '', '', '', '', '', '', '', '', '', 'FAILED', String(e && e.stack || e).slice(0, 500)]], [2, 3]);
    alertOwners_('Demand planning run failed', String(e && e.message || e));
    throw e;
  } finally {
    lock.releaseLock();
  }
}

function alertOwners_(subject, body) {
  var to = [prop_('REVIEWER_EMAIL'), prop_('BACKUP_EMAIL')].filter(String).join(',');
  if (to) MailApp.sendEmail(to, subject, body + '\n\n' + SpreadsheetApp.getActive().getUrl());
}

function runPipelineFromMenu() {
  var ui = SpreadsheetApp.getUi();
  var r = runPipeline();
  if (!r) { ui.alert('Another run is in progress.'); return; }
  if (r.ok === false) { ui.alert('Run aborted:\n' + r.errors.join('\n')); return; }
  ui.alert('Run ' + r.runId + ' (' + r.mode + '): ' + r.flagged + ' SKU(s) flagged.\n\n' + r.summary +
    (r.mode === 'SHADOW' ? '\n\nShadow mode: results are in Shadow_Log. Set SHADOW_MODE to FALSE in Rules_Config to send them to Review.' : ''));
}
