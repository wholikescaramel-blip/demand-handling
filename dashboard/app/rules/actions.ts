"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSql } from "@/lib/db";
import { draftProposal } from "@/lib/feedback";
import { loadRules } from "@/lib/planning";
import { RULE_DEFS, checkRules, parseRuleInput, type Rules } from "@/lib/rules";

const back = (params: Record<string, string>) => `/rules?${new URLSearchParams(params).toString()}`;

/** Save every rule value from the form, or none of them if anything is invalid. */
export async function saveRules(formData: FormData) {
  const values: Record<string, number | boolean> = {};
  const errors: string[] = [];
  for (const d of RULE_DEFS) {
    const parsed = parseRuleInput(d, String(formData.get(d.key) ?? ""));
    if (parsed.ok) values[d.key] = parsed.value;
    else errors.push(parsed.error);
  }
  if (!errors.length) errors.push(...checkRules(values as unknown as Rules));
  if (errors.length) redirect(back({ error: errors.slice(0, 3).join(" ") }));

  const sql = getSql();
  for (const [key, value] of Object.entries(values)) {
    await sql`insert into rules (key, value) values (${key}, ${String(value)}) on conflict (key) do update set value = excluded.value`;
  }
  revalidatePath("/rules");
  redirect(back({ ok: "Rules saved. They apply from the next planning run." }));
}

export async function resetRules() {
  await getSql()`delete from rules`;
  revalidatePath("/rules");
  redirect(back({ ok: "Rules are back to Raghav's original numbers." }));
}

export async function askProposal(formData: FormData) {
  const text = await draftProposal(Number(formData.get("id")), await loadRules());
  revalidatePath("/rules");
  redirect(
    text
      ? back({ ok: "A suggestion was drafted. It is only a suggestion: you decide." })
      : back({ error: "No suggestion could be drafted (it needs the Gemini key and some written reasons)." }),
  );
}

export async function closeReview(formData: FormData) {
  await getSql()`update rule_reviews set status = 'CLOSED' where id = ${Number(formData.get("id"))}`;
  revalidatePath("/rules");
  redirect(back({ ok: "Marked as reviewed." }));
}
