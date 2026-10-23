"use server";

import { dbConfigured, getSql } from "@/lib/db";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { mondayOf } from "@/lib/impact";
import { currentReviewer } from "@/lib/reviewer";

const back = (params: Record<string, string>) => `/?${new URLSearchParams(params).toString()}#impact`;

/** "1.25" (rupees lakh) -> 125000 rupees. Returns null when the text is not a non-negative number. */
function lakhToRupees(raw: FormDataEntryValue | null): number | null {
  const s = String(raw ?? "").trim().replace(/,/g, "");
  if (s === "") return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100000);
}

export async function saveLossEntry(formData: FormData) {
  if (!dbConfigured()) redirect(back({ error: "The database is not connected." }));
  const sql = getSql();

  const who = await currentReviewer();
  if (!who) redirect(back({ error: "Choose who is entering this (Raghav or Deepa) in the top bar first." }));

  const day = String(formData.get("week") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) redirect(back({ error: "Pick a date in the week you are reporting." }));
  const week = mondayOf(day);
  if (week > new Date().toISOString().slice(0, 10)) redirect(back({ error: "That week has not started yet." }));

  const stockout = lakhToRupees(formData.get("stockout"));
  const overstock = lakhToRupees(formData.get("overstock"));
  const perishable = lakhToRupees(formData.get("perishable"));
  if (stockout === null || overstock === null || perishable === null) {
    redirect(back({ error: "Amounts are in rupees lakh, for example 1.25 (up to two decimals, no other characters)." }));
  }
  if (perishable > overstock) redirect(back({ error: "The perishable part cannot be more than the whole overstock write-off." }));

  const note = String(formData.get("note") ?? "").trim().slice(0, 300) || null;

  await sql`
    insert into loss_entries (week_start, stockout_loss, overstock_writeoff, perishable_part, note, entered_by, entered_at)
    values (${week}, ${stockout}, ${overstock}, ${perishable}, ${note}, ${who}, now())
    on conflict (week_start) do update set
      stockout_loss = excluded.stockout_loss, overstock_writeoff = excluded.overstock_writeoff,
      perishable_part = excluded.perishable_part, note = excluded.note, entered_by = excluded.entered_by, entered_at = now()`;
  revalidatePath("/");
  redirect(back({ ok: `Week of ${week} saved.` }));
}
