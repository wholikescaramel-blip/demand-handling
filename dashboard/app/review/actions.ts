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

