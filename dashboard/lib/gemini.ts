/**
 * Gemini explains; it never decides. The engine computes every number, Gemini only words them. Every reply is checked:
 * if it contains a number that was not in the facts we sent, or the call fails, the template reason is used instead.
 * Without GEMINI_API_KEY the app works exactly the same, with template wording.
 */
import type { EngineResult, Rec } from "./engine.ts";
import type { Rules } from "./rules.ts";

export const geminiConfigured = () => Boolean(process.env.GEMINI_API_KEY);
const BATCH = 40;
type Fetcher = typeof fetch;

/** True when every number in `text` also appears in `allowedText`. */
export function usesOnlyAllowedNumbers(text: string, allowedText: string): boolean {
  const allowed = new Set((allowedText.match(/\d+(?:\.\d+)?/g) ?? []).map((n) => String(Number(n))));
  return (text.match(/\d+(?:\.\d+)?/g) ?? []).every((n) => allowed.has(String(Number(n))));
}

function factsFor(rec: Rec, rules: Rules) {
  return {
    sku: rec.sku, name: rec.name, perishable: rec.perishable, action: rec.action, qty: rec.qty, flags: rec.flags, onHand: rec.onHand,
    onOrder: rec.openPo, avg12WeekUnits: rec.avg12, avg4WeekUnits: rec.avg4, recentVsBaselinePct: rec.trendPct, weeksOfCover: rec.coverWeeks,
    floorWeeks: rec.floorWeeks, ceilingWeeks: rec.ceilingWeeks, festivalMonth: rec.festival,
    festivalUpliftPct: Math.round(rules.FESTIVAL_UPLIFT * 100), notes: rec.notes,
  };
}

async function callGemini(fetcher: Fetcher, system: string, user: string, schema: unknown): Promise<unknown> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not set");
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: user }] }],
    generationConfig: { temperature: 0.2, responseMimeType: "application/json", responseSchema: schema },
  };
  let lastErr = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetcher(url, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(body) });
    if (res.ok) {
      const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      return JSON.parse(data.candidates?.[0]?.content?.parts?.[0]?.text ?? "null");
    }
    lastErr = `HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`;
    await new Promise((r) => setTimeout(r, attempt === 0 ? 1500 : 0));
  }
  throw new Error(lastErr);
}

const REASON_SYSTEM =
  "You write one-line reasons for a demand planner reviewing stock recommendations. Use ONLY the numbers in the facts you are given; " +
  "never invent, estimate or calculate a new number. Do not forecast. Max 25 words per reason, plain English, no markdown. " +
  "Mention the festival uplift only if festivalMonth is true.";

/** Returns the reasons Gemini wrote (validated). Missing SKUs keep their template reason. `error` explains any fallback. */
export async function explainRecs(recs: Rec[], rules: Rules, fetcher: Fetcher = fetch): Promise<{ reasons: Record<string, string>; source: Record<string, "gemini" | "template">; error: string }> {
  const reasons: Record<string, string> = {};
  const source: Record<string, "gemini" | "template"> = {};
  for (const r of recs) {
    reasons[r.sku] = r.reason;
    source[r.sku] = "template";
  }
  if (!recs.length) return { reasons, source, error: "" };
  if (!geminiConfigured()) return { reasons, source, error: "Gemini key not set: standard wording used" };

  const schema = { type: "ARRAY", items: { type: "OBJECT", properties: { sku: { type: "STRING" }, reason: { type: "STRING" } }, required: ["sku", "reason"] } };
  let error = "";
  for (let i = 0; i < recs.length; i += BATCH) {
    const factsText = JSON.stringify(recs.slice(i, i + BATCH).map((r) => factsFor(r, rules)));
    try {
      const out = (await callGemini(fetcher, REASON_SYSTEM, `Write one reason per item. Facts:\n${factsText}`, schema)) as { sku: string; reason: string }[] | null;
      for (const item of out ?? []) {
        if (item?.sku in reasons && item.reason && usesOnlyAllowedNumbers(item.reason, factsText)) {
          reasons[item.sku] = item.reason.trim();
          source[item.sku] = "gemini";
        }
      }
    } catch (e) {
      error = (e instanceof Error ? e.message : String(e)).slice(0, 200);
    }
  }
  return { reasons, source, error };
}

/** 2-3 sentence summary of the run, with a template fallback. */
export async function summarizeRun(result: EngineResult, rules: Rules, fetcher: Fetcher = fetch): Promise<string> {
  const counts: Record<string, number> = {};
  for (const r of result.recs) counts[r.action] = (counts[r.action] ?? 0) + 1;
  const fallback =
    `${result.recs.length} of ${result.skuCount} SKUs flagged` +
    (result.festival ? ` (festival month, +${Math.round(rules.FESTIVAL_UPLIFT * 100)}% applied)` : "") +
    `. ${Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(", ")}.`;
  if (!geminiConfigured()) return fallback;
  const factsText = JSON.stringify({
    skusReviewed: result.skuCount, flagged: result.recs.length, healthy: result.healthy, actionCounts: counts, festivalMonth: result.festival,
    anomalies: result.anomalies, topPriority: result.recs.slice(0, 5).map((r) => ({ sku: r.sku, name: r.name, action: r.action, priority: r.priority })),
  });
  try {
    const out = (await callGemini(
      fetcher,
      "Summarise a demand-planning run for the planner in 2-3 sentences. Use ONLY numbers present in the facts. Do not forecast or advise ordering quantities.",
      `Facts:\n${factsText}`,
      { type: "OBJECT", properties: { summary: { type: "STRING" } }, required: ["summary"] },
    )) as { summary?: string } | null;
    return out?.summary && usesOnlyAllowedNumbers(out.summary, factsText) ? out.summary.trim() : fallback;
  } catch {
    return fallback;
  }
}

/** A suggestion for a rule that keeps being changed. Text only: a human decides. */
export async function proposeRuleText(rule: string, reasons: string[], changed: number, total: number, fetcher: Fetcher = fetch): Promise<string> {
  if (!geminiConfigured() || !reasons.length) return "";
  const facts = JSON.stringify({ rule, changed, decisions: total, reviewerReasons: reasons.slice(0, 25) });
  try {
    const out = (await callGemini(
      fetcher,
      "You help tune demand-planning rules. From the reviewer reasons, propose in at most 3 sentences what might be wrong with the rule and one concrete adjustment to test. This is a proposal only; a human decides.",
      `Facts:\n${facts}`,
      { type: "OBJECT", properties: { proposal: { type: "STRING" } }, required: ["proposal"] },
    )) as { proposal?: string } | null;
    return out?.proposal ?? "";
  } catch {
    return "";
  }
}
