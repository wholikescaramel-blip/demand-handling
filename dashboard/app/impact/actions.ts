"use server";

import { dbConfigured, getSql } from "@/lib/db";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { mondayOf } from "@/lib/impact";

const back = (params: Record<string, string>) => `/impact?${new URLSearchParams(params).toString()}`;

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

  const jar = await cookies();
  const who = (jar.get("dp_user")?.value || "reviewer").slice(0, 60);
  const note = String(formData.get("note") ?? "").trim().slice(0, 300) || null;

  await sql`
    insert into loss_entries (week_start, stockout_loss, overstock_writeoff, perishable_part, note, entered_by, entered_at)
    values (${week}, ${stockout}, ${overstock}, ${perishable}, ${note}, ${who}, now())
    on conflict (week_start) do update set
      stockout_loss = excluded.stockout_loss, overstock_writeoff = excluded.overstock_writeoff,
      perishable_part = excluded.perishable_part, note = excluded.note, entered_by = excluded.entered_by, entered_at = now()`;
  revalidatePath("/impact");
  revalidatePath("/");
  redirect(back({ ok: `Week of ${week} saved.` }));
}

export async function saveImpactSettings(formData: FormData) {
  if (!dbConfigured()) redirect(back({ error: "The database is not connected." }));
  const sql = getSql();

  const goLive = String(formData.get("go_live") ?? "").trim();
  if (goLive && !/^\d{4}-\d{2}-\d{2}$/.test(goLive)) redirect(back({ error: "Go-live must be a date." }));
  const low = lakhToRupees(formData.get("baseline_low"));
  const high = lakhToRupees(formData.get("baseline_high"));
  const per = String(formData.get("baseline_perishable") ?? "").trim();
  const perRupees = per === "" ? "" : lakhToRupees(per);
  const horizon = Number(formData.get("horizon_days") || 90);
  if (low === null || high === null || perRupees === null || !low || !high) redirect(back({ error: "Baseline amounts are in rupees lakh, for example 28 and 34." }));
  if (low! > high!) redirect(back({ error: "The low end of the baseline cannot be above the high end." }));
  if (!Number.isInteger(horizon) || horizon < 14 || horizon > 365) redirect(back({ error: "The evaluation point must be between 14 and 365 days." }));

  const rows: [string, string][] = [
    ["go_live", goLive],
    ["baseline_low", String(low)],
    ["baseline_high", String(high)],
    ["baseline_perishable_quarter", perRupees === "" ? "" : String(perRupees)],
    ["horizon_days", String(horizon)],
  ];
  for (const [key, value] of rows) {
    await sql`insert into settings (key, value) values (${key}, ${value}) on conflict (key) do update set value = excluded.value`;
  }
  revalidatePath("/impact");
  revalidatePath("/");
  redirect(back({ ok: "Settings saved." }));
}
