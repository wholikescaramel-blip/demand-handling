/**
 * Gemini explains; it never decides. The engine computes every number, Gemini only words them.
 * Every reply is checked: if it contains a number that was not in the facts we sent, or the call fails,
 * the deterministic template reason from Engine.js is used instead.
 */

var GEMINI_BATCH_SIZE = 40;

function geminiModel_() {
  return prop_('GEMINI_MODEL') || 'gemini-2.5-flash';
}

/** True when every number in `text` also appears in `allowedText`. Pure, unit-tested. */
function usesOnlyAllowedNumbers(text, allowedText) {
  var allowed = {};
  (String(allowedText).match(/\d+(?:\.\d+)?/g) || []).forEach(function (n) { allowed[String(Number(n))] = true; });
  var found = String(text).match(/\d+(?:\.\d+)?/g) || [];
  return found.every(function (n) { return allowed[String(Number(n))]; });
}

function factsFor_(rec, rules) {
  return {
    sku: rec.sku, name: rec.name, perishable: rec.perishable, action: rec.action, qty: rec.qty,
    flags: rec.flags, onHand: rec.onHand, openPo: rec.openPo, avg12WeekUnits: rec.avg12,
    avg4WeekUnits: rec.avg4, recentVsBaselinePct: rec.trendPct, weeksOfCover: rec.coverWeeks,
    floorWeeks: rec.floorWeeks, ceilingWeeks: rec.ceilingWeeks, festivalMonth: rec.festival,
    festivalUpliftPct: Math.round(rules.FESTIVAL_UPLIFT * 100), notes: rec.notes
  };
}

/** One generateContent call. Returns {json, tokens} or throws. */
function callGemini_(systemText, userText, schema) {
  var key = prop_('GEMINI_API_KEY');
  if (!key) throw new Error('GEMINI_API_KEY not set');
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + geminiModel_() + ':generateContent';
  var body = {
    systemInstruction: { parts: [{ text: systemText }] },
    contents: [{ role: 'user', parts: [{ text: userText }] }],
    generationConfig: { temperature: 0.2, responseMimeType: 'application/json', responseSchema: schema }
  };
  var lastErr;
  for (var attempt = 0; attempt < 2; attempt++) {
    var resp = UrlFetchApp.fetch(url, {
      method: 'post', contentType: 'application/json', headers: { 'x-goog-api-key': key },
      payload: JSON.stringify(body), muteHttpExceptions: true
    });
    if (resp.getResponseCode() === 200) {
      var data = JSON.parse(resp.getContentText());
      var text = data.candidates[0].content.parts[0].text;
      var usage = data.usageMetadata || {};
      return { json: JSON.parse(text), tokens: (usage.promptTokenCount || 0) + (usage.candidatesTokenCount || 0) };
    }
    lastErr = 'HTTP ' + resp.getResponseCode() + ': ' + resp.getContentText().slice(0, 200);
    Utilities.sleep(2500);
  }
  throw new Error(lastErr);
}

var REASON_SYSTEM_ =
  'You write one-line reasons for a demand planner reviewing stock recommendations. ' +
  'Use ONLY the numbers in the facts you are given; never invent, estimate or calculate a new number. ' +
  'Do not forecast. Max 25 words per reason, plain English, no markdown. Mention the festival uplift only if festivalMonth is true.';

/** Returns {reasons: {sku: text}, source: {sku: 'gemini'|'template'}, tokens, error}. */
function explainRecs_(recs, rules) {
  var out = { reasons: {}, source: {}, tokens: 0, error: '' };
  recs.forEach(function (r) { out.reasons[r.sku] = r.reason; out.source[r.sku] = 'template'; });
  if (!recs.length) return out;
  if (!prop_('GEMINI_API_KEY')) { out.error = 'GEMINI_API_KEY not set: template reasons used'; return out; }

  var schema = {
    type: 'ARRAY',
    items: { type: 'OBJECT', properties: { sku: { type: 'STRING' }, reason: { type: 'STRING' } }, required: ['sku', 'reason'] }
  };
  for (var i = 0; i < recs.length; i += GEMINI_BATCH_SIZE) {
    var batch = recs.slice(i, i + GEMINI_BATCH_SIZE);
    var facts = batch.map(function (r) { return factsFor_(r, rules); });
    var factsText = JSON.stringify(facts);
    try {
      var res = callGemini_(REASON_SYSTEM_, 'Write one reason per item. Facts:\n' + factsText, schema);
      out.tokens += res.tokens;
      res.json.forEach(function (item) {
        if (out.reasons.hasOwnProperty(item.sku) && item.reason && usesOnlyAllowedNumbers(item.reason, factsText)) {
          out.reasons[item.sku] = item.reason.trim();
          out.source[item.sku] = 'gemini';
        }
      });
    } catch (e) {
      out.error = String(e.message || e).slice(0, 200);
    }
  }
  return out;
}

/** 2-3 sentence trend and anomaly summary of the whole run. */
function summarizeRun_(result, rules) {
  var counts = {};
  result.recs.forEach(function (r) { counts[r.action] = (counts[r.action] || 0) + 1; });
  var fallback = result.recs.length + ' of ' + result.skuCount + ' SKUs flagged' +
    (result.festival ? ' (festival month, +' + Math.round(rules.FESTIVAL_UPLIFT * 100) + '% applied)' : '') + '. ' +
    Object.keys(counts).map(function (k) { return counts[k] + ' ' + k; }).join(', ') + '.';
  if (!prop_('GEMINI_API_KEY')) return { text: fallback, tokens: 0 };

  var facts = {
    skusReviewed: result.skuCount, flagged: result.recs.length, healthy: result.healthy, actionCounts: counts,
    festivalMonth: result.festival, anomalies: result.anomalies,
    topPriority: result.recs.slice(0, 5).map(function (r) { return { sku: r.sku, name: r.name, action: r.action, priority: r.priority }; })
  };
  var factsText = JSON.stringify(facts);
  try {
    var res = callGemini_(
      'Summarise a demand-planning run for the planner in 2-3 sentences. Use ONLY numbers present in the facts. Do not forecast or advise ordering quantities.',
      'Facts:\n' + factsText,
      { type: 'OBJECT', properties: { summary: { type: 'STRING' } }, required: ['summary'] }
    );
    if (res.json.summary && usesOnlyAllowedNumbers(res.json.summary, factsText)) return { text: res.json.summary.trim(), tokens: res.tokens };
    return { text: fallback, tokens: res.tokens };
  } catch (e) {
    return { text: fallback, tokens: 0 };
  }
}

/** Monthly: Gemini PROPOSES a rule tweak from override reasons. A human edits Rules_Config; nothing is applied here. */
function proposeRuleText_(ruleName, reasons, overrideCount, totalCount) {
  if (!prop_('GEMINI_API_KEY') || !reasons.length) return '';
  var facts = JSON.stringify({ rule: ruleName, overrides: overrideCount, decisions: totalCount, reviewerReasons: reasons.slice(0, 25) });
  try {
    var res = callGemini_(
      'You help tune demand-planning rules. From the reviewer reasons, propose in at most 3 sentences what might be wrong with the rule and one concrete adjustment to test. This is a proposal only; a human decides.',
      'Facts:\n' + facts,
      { type: 'OBJECT', properties: { proposal: { type: 'STRING' } }, required: ['proposal'] }
    );
    return res.json.proposal || '';
  } catch (e) {
    return '';
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { usesOnlyAllowedNumbers: usesOnlyAllowedNumbers };
}
