/** One-time setup, the custom menu and trigger installation. */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Demand Planning')
    .addItem('1. Set up this spreadsheet', 'setup')
    .addItem('2. Configure (Drive folder, Gemini key, emails)', 'configure')
    .addSeparator()
    .addItem('Run pipeline now', 'runPipelineFromMenu')
    .addItem('Finalise decisions', 'finaliseReview')
    .addSeparator()
    .addItem('Ask Gemini to propose rule changes', 'proposeRuleChanges')
    .addItem('Pull decisions from dashboard', 'pullDecisionsFromMenu')
    .addItem('Sync to dashboard (back-fill)', 'syncAllToDashboard')
    .addItem('Install Tue/Fri schedule', 'installTriggers')
    .addToUi();
}

function setup() {
  var ss = SpreadsheetApp.getActive();

  var rulesSheet = getOrCreateSheet_(SHEETS.RULES);
  if (rulesSheet.getLastRow() < 2) {
    writeTable_(SHEETS.RULES, ['Key', 'Value', 'What it does'], DEFAULT_RULES);
    rulesSheet.setColumnWidth(1, 220); rulesSheet.setColumnWidth(2, 90); rulesSheet.setColumnWidth(3, 700);
    rulesSheet.getRange('B2:B' + (DEFAULT_RULES.length + 1)).setBackground('#fff4df');
  }

  var order = [SHEETS.RULES, SHEETS.REVIEW, SHEETS.APPROVED, SHEETS.REJECTIONS, SHEETS.DECISIONS, SHEETS.METRICS,
    SHEETS.POS, SHEETS.RULE_REVIEW, SHEETS.SHADOW, SHEETS.RUNS, SHEETS.SALES, SHEETS.SKU, SHEETS.INV, SHEETS.INV_HIST,
    SHEETS.CAL, SHEETS.DIST, SHEETS.PO];
  order.forEach(function (name, i) {
    if (!ss.getSheetByName(name)) {
      var sh = ss.insertSheet(name);
      var headers = { Review: REVIEW_HEADER, Approved: APPROVED_HEADER, Rejections: REJECTION_HEADER, Decision_Log: DECISION_HEADER,
        Shadow_Log: SHADOW_HEADER, Run_Log: RUN_HEADER, Purchase_Orders: PO_HEADER };
      if (headers[name]) {
        sh.getRange(1, 1, 1, headers[name].length).setValues([headers[name]]).setFontWeight('bold').setBackground('#14213d').setFontColor('#ffffff');
        sh.setFrozenRows(1);
      }
    }
    ss.setActiveSheet(ss.getSheetByName(name));
    ss.moveActiveSheet(i + 1);
  });
  var first = ss.getSheetByName('Sheet1');
  if (first && first.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(first);

  buildMetrics_();
  installTriggers();
  ss.setActiveSheet(ss.getSheetByName(SHEETS.RULES));
  SpreadsheetApp.getUi().alert('Setup done.\n\nNext: Demand Planning > Configure, then drop the CSVs in your Drive folder and run the pipeline.');
}

/** Metrics tab: live formulas over Decision_Log and Approved, mapped to the kill criteria. */
function buildMetrics_() {
  var sh = getOrCreateSheet_(SHEETS.METRICS);
  sh.clear();
  var D = SHEETS.DECISIONS;
  var rows = [
    ['Metric', 'Value', 'Why it matters'],
    ['Approved as recommended', '=COUNTIF(' + D + '!H:H,"Approve")', ''],
    ['Overridden (qty changed)', '=COUNTIF(' + D + '!H:H,"Override")', 'Reasons are documenting the 15-20% Raghav handles on judgment'],
    ['Rejected', '=COUNTIF(' + D + '!H:H,"Reject")', ''],
    ['Expired (not decided in time)', '=COUNTIF(' + D + '!H:H,"EXPIRED")', 'Rising expiries mean the review gate is not being used'],
    ['Override + reject rate', '=IFERROR((B3+B4)/(B2+B3+B4),"n/a")', 'Adoption kill line: above 40% for 4 straight weeks'],
    ['Adoption kill line breached?', '=IF(ISNUMBER(B6),IF(B6>0.4,"YES: review the rules","no"),"n/a")', ''],
    ['Avg hours to decide', '=IFERROR(AVERAGE(' + D + '!L2:L),"n/a")', 'Target: within 24 hours'],
    ['POs recorded by procurement', '=COUNTA(Approved!I2:I)', 'PO numbers are filled in from the dashboard'],
    ['Runs logged', '=COUNTA(Run_Log!A2:A)', ''],
    ['Gemini tokens used (all runs)', '=SUM(Run_Log!K2:K)', 'Running cost: tokens x model price']
  ];
  sh.getRange(1, 1, rows.length, 3).setValues(rows);
  sh.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground('#14213d').setFontColor('#ffffff');
  sh.getRange('B6').setNumberFormat('0%');
  sh.setColumnWidth(1, 260); sh.setColumnWidth(2, 160); sh.setColumnWidth(3, 460);
}

function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['runPipeline', 'checkSla', 'pullDecisions'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  // Export lands Tue/Fri early; the pipeline runs after it.
  ScriptApp.newTrigger('runPipeline').timeBased().onWeekDay(ScriptApp.WeekDay.TUESDAY).atHour(8).create();
  ScriptApp.newTrigger('runPipeline').timeBased().onWeekDay(ScriptApp.WeekDay.FRIDAY).atHour(8).create();
  ScriptApp.newTrigger('checkSla').timeBased().everyDays(1).atHour(10).create();
  ScriptApp.newTrigger('pullDecisions').timeBased().everyHours(1).create();
}

var CONFIG_KEYS_ = [
  ['DRIVE_FOLDER_ID', 'Drive folder ID holding the CSV exports (the long id at the end of the folder URL)'],
  ['GEMINI_API_KEY', 'Gemini API key (stored as a script property, never in a cell)'],
  ['GEMINI_MODEL', 'Gemini model, e.g. gemini-2.5-flash (blank = default)'],
  ['REVIEWER_EMAIL', "Raghav's email (gets 'ready to review' and overdue alerts)"],
  ['BACKUP_EMAIL', 'Backup approver email (gets overdue alerts)'],
  ['PROCUREMENT_EMAIL', 'Procurement email (gets the approved list notice)'],
  ['DASHBOARD_URL', 'Optional: web dashboard URL, e.g. https://your-app.vercel.app (blank = no dashboard)'],
  ['SYNC_SECRET', 'Optional: shared secret, must equal SYNC_SECRET in the dashboard environment']
];
var MASKED_KEYS_ = ['GEMINI_API_KEY', 'SYNC_SECRET'];

function configure() {
  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();
  CONFIG_KEYS_.forEach(function (k) {
    var cur = props.getProperty(k[0]);
    var shown = !cur ? '(not set)' : MASKED_KEYS_.indexOf(k[0]) >= 0 ? '(set)' : cur;
    var r = ui.prompt(k[0], k[1] + '\n\nCurrent: ' + shown + '\nLeave blank to keep it.', ui.ButtonSet.OK_CANCEL);
    if (r.getSelectedButton() !== ui.Button.OK) return;
    var v = r.getResponseText().trim();
    if (v) props.setProperty(k[0], v);
  });
  ui.alert('Saved.');
}
