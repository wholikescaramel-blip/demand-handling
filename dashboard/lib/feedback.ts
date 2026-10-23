/**
 * Re-evaluating the rules. The rules are fixed thresholds and never change by themselves. When Raghav changes the
 * quantity on, or rejects, the same rule OVERRIDE_ALERT_COUNT times within OVERRIDE_ALERT_DAYS, that rule is queued for
 * review. Gemini can draft a suggestion from his reasons; Raghav and Deepa decide whether to edit the rule.
 */
import { getSql } from "./db.ts";
import { proposeRuleText } from "./gemini.ts";
import type { Rules } from "./rules.ts";

/** Call after each decision. Returns the rules newly queued for review. */
export async function evaluateRuleFeedback(rules: Rules): Promise<string[]> {
  const sql = getSql();
  const rows = await sql`
    select flags, decision from decisions
    where decision in ('Approve', 'Override', 'Reject') and decided_at >= now() - (${rules.OVERRIDE_ALERT_DAYS} * interval '1 day')`;
  const by = new Map<string, { total: number; changed: number }>();
  for (const r of rows) {
    for (const f of String(r.flags ?? "").split(" + ").filter(Boolean)) {
      const b = by.get(f) ?? { total: 0, changed: 0 };
      b.total++;
      if (r.decision === "Override" || r.decision === "Reject") b.changed++;
      by.set(f, b);
    }
  }
  const opened: string[] = [];
  for (const [rule, b] of by) {
    if (b.changed < rules.OVERRIDE_ALERT_COUNT) continue;
    const open = await sql`select 1 from rule_reviews where rule = ${rule} and status = 'OPEN' limit 1`;
    if (open.length) continue;
    await sql`insert into rule_reviews (opened_at, rule, changed, total, rate, status)
              values (now(), ${rule}, ${b.changed}, ${b.total}, ${`${Math.round((b.changed / b.total) * 100)}%`}, 'OPEN')`;
    opened.push(rule);
  }
  return opened;
}

/** Ask Gemini for a text suggestion for one queued rule. Nothing is applied. */
export async function draftProposal(reviewId: number, rules: Rules, fetcher: typeof fetch = fetch): Promise<string> {
  const sql = getSql();
  const [rv] = await sql`select id, rule, changed, total from rule_reviews where id = ${reviewId}`;
  if (!rv) return "";
  const reasons = await sql`
    select reason from decisions
    where decision in ('Override', 'Reject') and reason is not null and flags like ${"%" + String(rv.rule) + "%"}
      and decided_at >= now() - (${rules.OVERRIDE_ALERT_DAYS} * interval '1 day') order by decided_at desc limit 25`;
  const text = await proposeRuleText(String(rv.rule), reasons.map((r) => String(r.reason)), Number(rv.changed), Number(rv.total), fetcher);
  if (text) await sql`update rule_reviews set proposal = ${text} where id = ${reviewId}`;
  return text;
}
