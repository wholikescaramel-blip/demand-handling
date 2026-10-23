"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { dbConfigured, getSql } from "@/lib/db";
import { recordDecision } from "@/lib/decisions";
import { generatePosForReady } from "@/lib/orders";
import { runPlanning } from "@/lib/planning";
import { getPo } from "@/lib/data";
import { buildPoPdf, poOptionsFromEnv } from "@/lib/pdf";
import { mailConfigured, sendMail, validEmail } from "@/lib/mail";

const back = (params: Record<string, string>) => `/review?${new URLSearchParams(params).toString()}`;

async function userName(): Promise<string> {
  return ((await cookies()).get("dp_user")?.value || "reviewer").slice(0, 60);
}

function refresh() {
  for (const p of ["/", "/review", "/orders", "/decisions", "/rules"]) revalidatePath(p);
}

/** Raghav presses Approve or Reject on one card. Approve creates that line's PO right away. */
export async function decide(formData: FormData) {
  const sku = String(formData.get("sku") ?? "");
  const out = await recordDecision({
    run_id: String(formData.get("run_id") ?? ""), sku, button: String(formData.get("decision") ?? ""),
    qty: String(formData.get("qty") ?? ""), reason: String(formData.get("reason") ?? ""), reviewer: await userName(),
  });
  refresh();
  redirect(out.ok ? back({ ok: out.message }) : back({ error: out.error, sku }));
}

/** Pull the latest data from Neon, apply the rules, and put the recommendations in front of Raghav. */
export async function runPlanningNow() {
  const r = await runPlanning(await userName());
  refresh();
  redirect(r.ok ? back({ ok: `New run ${r.runId}: ${r.message}` }) : back({ error: r.message }));
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

/** Email a PO's PDF to the vendor (or anyone). */
export async function sendPoEmail(formData: FormData) {
  const from = String(formData.get("from") ?? "orders");
  const dest = (p: Record<string, string>) => `/${from === "review" ? "review" : "orders"}?${new URLSearchParams(p).toString()}`;
  const po_number = String(formData.get("po_number") ?? "");
  const to = String(formData.get("to") ?? "").trim();
  if (!dbConfigured()) redirect(dest({ error: "The database is not connected." }));
  if (!validEmail(to)) redirect(dest({ error: `Enter a valid email address for ${po_number}.` }));
  if (!mailConfigured()) redirect(dest({ error: "Email is not set up yet. You can still download the PDF." }));

  const po = await getPo(po_number);
  if (!po) redirect(dest({ error: "That purchase order no longer exists." }));
  const opts = poOptionsFromEnv();
  const company = opts.company?.name ?? "Freshroots";
  const r = await sendMail({
    to,
    subject: `Purchase order ${po!.po_number} from ${company}`,
    body:
      `Dear ${po!.vendor?.name ?? po!.vendor_name ?? "supplier"},\n\nPlease find purchase order ${po!.po_number} attached: ${po!.lines.length} item(s), ${po!.total_qty} units.\n` +
      `Please confirm the rates and the delivery date when you accept it, and quote the PO number on the delivery note and invoice.\n\n` +
      `Approved by ${po!.created_by ?? "our demand planner"}.\n\nRegards,\n${company}`,
    filename: `${po!.po_number}.pdf`,
    pdf: await buildPoPdf(po!, opts),
  });
  if (!r.ok) redirect(dest({ error: r.error }));

  const sql = getSql();
  await sql`update purchase_orders set sent_at = now(), sent_to = ${to} where po_number = ${po_number}`;
  await sql`insert into settings (key, value) values (${"email:" + po!.vendor_key}, ${to}) on conflict (key) do update set value = excluded.value`;
  refresh();
  redirect(dest({ ok: `${po_number} emailed to ${to}.` }));
}
