/**
 * Drive -> Sheets. Picks the newest CSV per prefix from the Drive folder (DRIVE_FOLDER_ID script property),
 * validates it and loads it into clean tabs.
 */

var CSV_SOURCES = [
  { prefix: 'weekly_sales', tab: SHEETS.SALES, required: true, textCols: [2], numCols: [3] },
  { prefix: 'sku_master', tab: SHEETS.SKU, required: true, textCols: [], numCols: [5] },
  { prefix: 'current_inventory', tab: SHEETS.INV, required: true, textCols: [4], numCols: [3] },
  { prefix: 'calendar', tab: SHEETS.CAL, required: true, textCols: [3], numCols: [] },
  { prefix: 'distributor_master', tab: SHEETS.DIST, required: false, textCols: [], numCols: [] },
  { prefix: 'open_pos', tab: SHEETS.PO, required: false, textCols: [3], numCols: [2] }
];

function findLatestCsv_(folder, prefix) {
  var best = null;
  var files = folder.getFiles();
  while (files.hasNext()) {
    var f = files.next();
    var n = f.getName().toLowerCase();
    if (n.indexOf(prefix) === 0 && n.slice(-4) === '.csv') {
      if (!best || f.getLastUpdated() > best.getLastUpdated()) best = f;
    }
  }
  return best;
}

function parseCsvFile_(file) {
  var text = file.getBlob().getDataAsString().replace(/^﻿/, '');
  return Utilities.parseCsv(text).filter(function (r) { return r.join('').trim() !== ''; });
}

function ingest_(rules) {
  var res = { ok: true, warnings: [], errors: [], stats: {}, asOf: null, files: {} };
  var folderId = prop_('DRIVE_FOLDER_ID');
  if (!folderId) {
    res.ok = false; res.errors.push('DRIVE_FOLDER_ID is not set (menu: Demand Planning > Configure).');
    return res;
  }
  var folder = DriveApp.getFolderById(folderId);
  var loaded = {};

  CSV_SOURCES.forEach(function (src) {
    var file = findLatestCsv_(folder, src.prefix);
    if (!file) {
      if (src.required) { res.ok = false; res.errors.push('Missing file: ' + src.prefix + '*.csv'); }
      else res.warnings.push('Optional file not found: ' + src.prefix + '*.csv');
      return;
    }
    var table = parseCsvFile_(file);
    var header = table[0].map(function (h) { return h.trim(); });
    var rows = table.slice(1).map(function (r) {
      return r.map(function (v, i) {
        v = String(v).trim();
        return src.numCols.indexOf(i + 1) >= 0 && v !== '' && isFinite(Number(v)) ? Number(v) : v;
      });
    });
    loaded[src.prefix] = { header: header, rows: rows };
    res.files[src.prefix] = file.getName();
    res.stats[src.prefix + '_rows'] = rows.length;
  });
  if (!res.ok) return res;

  // ---- validation: completeness is the day-30 kill gate (> 95%) ----
  var sales = loaded.weekly_sales.rows;
  var skuIds = loaded.sku_master.rows.map(function (r) { return r[0]; });
  var weeks = {};
  var seen = {};
  var valid = 0;
  sales.forEach(function (r) {
    weeks[r[1]] = true;
    if (typeof r[2] === 'number' && r[2] >= 0 && skuIds.indexOf(r[0]) >= 0) {
      var key = r[0] + '|' + r[1];
      if (!seen[key]) { seen[key] = true; valid++; }
    }
  });
  var expected = skuIds.length * Object.keys(weeks).length;
  var completeness = expected ? valid / expected : 0;
  res.stats.completeness = Math.round(completeness * 1000) / 10;
  res.stats.weeks = Object.keys(weeks).length;
  res.stats.skus = skuIds.length;
  if (completeness < rules.COMPLETENESS_MIN) {
    res.ok = false;
    res.errors.push('Sales completeness ' + res.stats.completeness + '% is below ' + rules.COMPLETENESS_MIN * 100 + '%. Run aborted, nothing was overwritten.');
    return res;
  }

  // ---- inventory as-of date drives festival month and the staleness warning ----
  var inv = loaded.current_inventory;
  var asOfIdx = inv.header.indexOf('As_Of_Date');
  var asOfs = inv.rows.map(function (r) { return r[asOfIdx]; }).filter(String).sort();
  res.asOf = asOfs.length ? asOfs[asOfs.length - 1] : null;
  if (!res.asOf) { res.ok = false; res.errors.push('Inventory file has no As_Of_Date.'); return res; }

  // ---- write clean tabs ----
  CSV_SOURCES.forEach(function (src) {
    var d = loaded[src.prefix];
    if (d) writeTable_(src.tab, d.header, d.rows, src.textCols);
  });

  // ---- keep every inventory snapshot so stockout days can be measured later ----
  var histHeader = ['SKU_ID', 'Location', 'Units_On_Hand', 'As_Of_Date'];
  var have = {};
  var hist = SpreadsheetApp.getActive().getSheetByName(SHEETS.INV_HIST);
  if (hist && hist.getLastRow() > 1) {
    hist.getRange(2, 1, hist.getLastRow() - 1, 4).getValues().forEach(function (r) { have[r[0] + '|' + r[1] + '|' + r[3]] = true; });
  }
  var fresh = inv.rows.filter(function (r) { return !have[r[0] + '|' + r[1] + '|' + r[3]]; });
  appendRows_(SHEETS.INV_HIST, histHeader, fresh, [4]);
  res.stats.inventory_snapshots_added = fresh.length;

  if (!loaded.open_pos) res.warnings.push('No open_pos.csv: flags may re-order stock that is already on order.');
  return res;
}

/** Sheets -> engine input. Values come back as strings for text columns, numbers for number columns. */
function readEngineInput_(rules, asOf) {
  var sales = readTable_(SHEETS.SALES).map(function (r) { return { sku: r.SKU_ID, week: String(r.Week), units: r.Units_Sold }; });
  var inventory = {};
  readTable_(SHEETS.INV).forEach(function (r) { inventory[r.SKU_ID] = Number(r.Units_On_Hand); });
  var openPos = {};
  readTable_(SHEETS.PO).forEach(function (r) { openPos[r.SKU_ID] = (openPos[r.SKU_ID] || 0) + Number(r.Qty_On_Order || 0); });
  var calendar = readTable_(SHEETS.CAL).map(function (r) {
    return { Year_Month: String(r.Year_Month), Is_Festival_Month: r.Is_Festival_Month };
  });
  return {
    sales: sales, skus: readTable_(SHEETS.SKU), inventory: inventory, openPos: openPos,
    calendar: calendar, rules: rules, asOf: asOf, today: todayIso_()
  };
}
