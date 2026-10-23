"use server";

import { currentReviewer } from "@/lib/reviewer";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { dbConfigured, getSql } from "@/lib/db";
import { recordDecision } from "@/lib/decisions";
import { generatePosForReady } from "@/lib/orders";
import { runPlanning } from "@/lib/planning";

const back = (params: Record<string, string>) => `/review?${new URLSearchParams(params).toString()}`;

const NO_REVIEWER = "Choose who is reviewing (Raghav or Deepa) in the top bar first.";

function refresh() {
  for (const p of ["/", "/stock", "/review", "/orders"]) revalidatePath(p);
}

/** Raghav presses Approve or Reject on one card. Approve creates that line's PO right away. */
export async function decide(formData: FormData) {
  const sku = String(formData.get("sku") ?? "");
  const reviewer = await currentReviewer();
  if (!reviewer) redirect(back({ error: NO_REVIEWER, sku }));
  const out = await recordDecision({
    run_id: String(formData.get("run_id") ?? ""), sku, button: String(formData.get("decision") ?? ""),
    qty: String(formData.get("qty") ?? ""), reason: String(formData.get("reason") ?? ""), reviewer: reviewer!,
  });
  refresh();
  redirect(out.ok ? back({ ok: out.message }) : back({ error: out.error, sku }));
}

/** Pull the latest data from Neon, apply the rules, and put the recommendations in front of Raghav. */
export async function runPlanningNow() {
  const reviewer = await currentReviewer();
  if (!reviewer) redirect("/?error=" + encodeURIComponent(NO_REVIEWER));
  const r = await runPlanning(reviewer!);
  refresh();
  redirect(r.ok ? `/review?${new URLSearchParams({ ok: `New run ${r.runId}: ${r.message}` })}` : "/?error=" + encodeURIComponent(r.message));
}

/** Retry the PO for every approved line that is still waiting (only needed if creating one failed). */
export async function generatePos() {
  const r = await generatePosForReady();
  refresh();
  if (r.failed.length) redirect("/orders?error=" + encodeURIComponent(r.failed.map((f) => `${f.vendor}: ${f.error}`).join("; ")));
  redirect(`/orders?created=${r.created.length}`);
}

/** Retry the PO for one approved line. */
export async function createPoForLine(formData: FormData) {
  const sku = String(formData.get("sku") ?? "");
  const r = await generatePosForReady({ run_id: String(formData.get("run_id") ?? ""), sku });
  refresh();
  if (r.failed.length) redirect(back({ error: r.failed[0].error, sku }));
  redirect(back({ ok: r.created.length ? `${sku}: ${r.created[0].po_number} created.` : `${sku}: nothing to create.` }));
}

/** Goods arrived: the PO stops counting as stock on order. */
export async function markReceived(formData: FormData) {
  await getSql()`update purchase_orders set received_at = now() where po_number = ${String(formData.get("po_number") ?? "")} and received_at is null`;
  refresh();
  redirect("/orders");
}


/** A person fills in what the rules cannot know about a SKU. It is saved, then planning runs at once so it shows up everywhere. */
export async function saveManualInfo(formData: FormData) {
  const sku = String(formData.get("sku") ?? "");
  const from = String(formData.get("from") ?? "review") === "stock" ? "/stock" : "/review";
  const go = (p: Record<string, string>) => redirect(`${from}?${new URLSearchParams(p).toString()}`);
  const reviewer = await currentReviewer();
  if (!reviewer) go({ error: NO_REVIEWER, sku });
  if (!dbConfigured()) go({ error: "The database is not connected.", sku });

  const onRaw = String(formData.get("on_hand") ?? "").trim();
  const demandRaw = String(formData.get("weekly_demand") ?? "").trim();
  if (onRaw !== "" && !/^\d+$/.test(onRaw)) go({ error: "Stock in hand must be a whole number.", sku });
  if (demandRaw !== "" && !(/^\d+(\.\d+)?$/.test(demandRaw) && Number(demandRaw) > 0)) go({ error: "Weekly demand must be a number above zero.", sku });
  if (onRaw === "" && demandRaw === "") go({ error: "Enter the stock in hand, the weekly demand, or both.", sku });
  const note = String(formData.get("note") ?? "").trim().slice(0, 300) || null;

  const sql = getSql();
  const known = await sql`select 1 from skus where sku_id = ${sku} and active`;
  if (!known.length) go({ error: `${sku} is not an active SKU.`, sku });
  await sql`
    insert into sku_manual (sku_id, on_hand, weekly_demand, note, entered_by, updated_at)
    values (${sku}, ${onRaw === "" ? null : Number(onRaw)}, ${demandRaw === "" ? null : Number(demandRaw)}, ${note}, ${reviewer}, now())
    on conflict (sku_id) do update set on_hand = excluded.on_hand, weekly_demand = excluded.weekly_demand, note = excluded.note,
      entered_by = excluded.entered_by, updated_at = now()`;

  const r = await runPlanning(reviewer!);
  refresh();
  go(r.ok ? { ok: `${sku} saved. ${r.message}` } : { error: `${sku} saved, but planning could not run: ${r.message}` });
}
