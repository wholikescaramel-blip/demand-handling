"use server";

import { neon } from "@neondatabase/serverless";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { checkDecision } from "@/lib/po";
import { generatePosForReady } from "@/lib/orders";
import { getPo, getSnapshot } from "@/lib/data";
import { buildPoPdf, poOptionsFromEnv } from "@/lib/pdf";
import { mailConfigured, sendMailViaWebApp, validEmail } from "@/lib/mail";
import { clearDemoDecisions, readDemoDecisions, writeDemoDecisions } from "@/lib/demo-store";

const back = (params: Record<string, string>) => `/review?${new URLSearchParams(params).toString()}`;

async function reviewerName(): Promise<string> {
  const jar = await cookies();
  return (jar.get("dp_user")?.value || "reviewer").slice(0, 60);
}

/**
 * Raghav presses Approve or Reject on one recommendation. First decision wins; it cannot be changed afterwards.
 * Approve orders the quantity in the box (pre-filled with the recommendation) and creates the PO straight away.
 * Reject needs a reason and creates nothing.
 */
export async function decide(formData: FormData) {
  const run_id = String(formData.get("run_id") ?? "");
  const sku = String(formData.get("sku") ?? "");
  const button = String(formData.get("decision") ?? "");
  const qty = String(formData.get("qty") ?? "");
  const reasonIn = String(formData.get("reason") ?? "");

  // ---- practice mode: no database, decisions live in this browser only
  if (!process.env.DATABASE_URL) {
    const snap = await getSnapshot();
    const rec = snap.recs.find((r) => r.run_id === run_id && r.sku === sku);
    if (!rec) redirect(back({ error: "That recommendation no longer exists.", sku }));
    if (rec!.decision) redirect(back({ error: "This one already has a decision.", sku }));
    const check = checkDecision({ action: rec!.action, recQty: rec!.rec_qty, button, qty, reason: reasonIn });
    if (!check.ok) redirect(back({ error: check.error, sku }));
    const list = await readDemoDecisions();
    list.push({ run_id, sku, decision: check.decision, final_qty: check.finalQty, reason: check.reason, at: new Date().toISOString() });
    await writeDemoDecisions(list);
    revalidatePath("/review");
    redirect(back({ ok: check.decision === "Reject" ? `${sku} rejected.` : check.finalQty ? `${sku} approved: PO created below.` : `${sku} approved: no order needed.` }));
  }

  const sql = neon(process.env.DATABASE_URL!);
  const [rec] = await sql`
    select r.action, r.rec_qty, r.flags, r.priority, u.run_at, u.mode
    from recommendations r join runs u on u.run_id = r.run_id
    where r.run_id = ${run_id} and r.sku = ${sku}`;
  if (!rec) redirect(back({ error: "That recommendation no longer exists.", sku }));
  if (rec.mode !== "LIVE") redirect(back({ error: "This run was in shadow mode: nothing to decide.", sku }));

  const check = checkDecision({
    action: rec.action,
    recQty: rec.rec_qty === null ? null : Number(rec.rec_qty),
    button, qty, reason: reasonIn,
  });
  if (!check.ok) redirect(back({ error: check.error, sku }));

  const reviewer = await reviewerName();
  const runAt = new Date(rec.run_at).toISOString();
  const rows = await sql`
    insert into decisions (decided_at, run_id, sku, action, rec_qty, flags, priority, decision, final_qty, reason, reviewer,
                           hours_to_decide, po_status)
    values (now(), ${run_id}, ${sku}, ${rec.action}, ${rec.rec_qty}, ${rec.flags}, ${rec.priority}, ${check.decision},
            ${check.finalQty}, ${check.reason}, ${reviewer},
            round((extract(epoch from (now() - ${runAt}::timestamptz)) / 3600)::numeric, 1), ${check.poStatus})
    on conflict (run_id, sku) do nothing
    returning sku`;
  if (!rows.length) redirect(back({ error: "Someone already decided this one.", sku }));

  // Approve with a quantity above zero: the PO is created right now, for this one line.
  let message = check.decision === "Reject" ? `${sku} rejected.` : `${sku} approved: no order needed.`;
  if (check.poStatus === "READY") {
    const gen = await generatePosForReady({ run_id, sku });
    message = gen.created.length
      ? `${sku} approved: ${gen.created[0].po_number} created below.`
      : `${sku} approved, but the PO could not be created yet. Use "Create PO" on its card to retry.`;
  }

  revalidatePath("/review");
  revalidatePath("/orders");
  revalidatePath("/");
  redirect(back({ ok: message }));
}

/** Retry the PO for every approved line that is still waiting (only needed if creating one failed). */
export async function generatePos() {
  if (!process.env.DATABASE_URL) redirect("/orders?error=" + encodeURIComponent("Practice mode creates POs when you approve; nothing is waiting."));
  const r = await generatePosForReady();
  revalidatePath("/orders");
  revalidatePath("/review");
  if (r.failed.length) redirect("/orders?error=" + encodeURIComponent(r.failed.map((f) => `${f.vendor}: ${f.error}`).join("; ")));
  redirect(`/orders?created=${r.created.length}`);
}

/** Retry the PO for one approved line. */
export async function createPoForLine(formData: FormData) {
  if (!process.env.DATABASE_URL) redirect(back({ error: "Practice mode creates POs when you approve." }));
  const run_id = String(formData.get("run_id") ?? "");
  const sku = String(formData.get("sku") ?? "");
  const r = await generatePosForReady({ run_id, sku });
  revalidatePath("/review");
  revalidatePath("/orders");
  if (r.failed.length) redirect(back({ error: r.failed[0].error, sku }));
  redirect(back({ ok: r.created.length ? `${sku}: ${r.created[0].po_number} created.` : `${sku}: nothing to create.` }));
}

/** Practice mode only: forget the practice decisions in this browser. */
export async function resetPractice() {
  await clearDemoDecisions();
  revalidatePath("/review");
  revalidatePath("/orders");
  revalidatePath("/");
  redirect(back({ ok: "Practice decisions cleared." }));
}

/** Goods arrived: the PO stops counting as stock on order. */
export async function markReceived(formData: FormData) {
  if (!process.env.DATABASE_URL) redirect("/orders?error=" + encodeURIComponent("Practice mode: connect a database to track receipts."));
  const sql = neon(process.env.DATABASE_URL!);
  await sql`update purchase_orders set received_at = now() where po_number = ${String(formData.get("po_number") ?? "")} and received_at is null`;
  revalidatePath("/orders");
  redirect("/orders");
}

/** Email a PO's PDF to the vendor (or anyone) through the Apps Script mail web app. */
export async function sendPoEmail(formData: FormData) {
  const from = String(formData.get("from") ?? "orders");
  const dest = (p: Record<string, string>) => `/${from === "review" ? "review" : "orders"}?${new URLSearchParams(p).toString()}`;
  if (!process.env.DATABASE_URL) redirect(dest({ error: "Practice mode: you can download the PO, but email needs a connected database." }));
  const po_number = String(formData.get("po_number") ?? "");
  const to = String(formData.get("to") ?? "").trim();
  if (!validEmail(to)) redirect(dest({ error: `Enter a valid email address for ${po_number}.` }));
  if (!mailConfigured()) redirect(dest({ error: "Email is not set up yet. You can still download the PDF." }));

  const po = await getPo(po_number);
  if (!po) redirect(dest({ error: "That purchase order no longer exists." }));
  const opts = poOptionsFromEnv();
  const pdf = await buildPoPdf(po!, opts);
  const company = opts.company?.name ?? "Freshroots";
  const r = await sendMailViaWebApp({
    to,
    subject: `Purchase order ${po!.po_number} from ${company}`,
    body:
      `Dear ${po!.vendor?.name ?? po!.vendor_name ?? "supplier"},\n\nPlease find purchase order ${po!.po_number} attached: ${po!.lines.length} item(s), ${po!.total_qty} units.\n` +
      `Please confirm the rates and the delivery date when you accept it, and quote the PO number on the delivery note and invoice.\n\n` +
      `Approved by ${po!.created_by ?? "our demand planner"}.\n\nRegards,\n${company}`,
    filename: `${po!.po_number}.pdf`,
    pdf,
  });
  if (!r.ok) redirect(dest({ error: r.error }));

  const sql = neon(process.env.DATABASE_URL!);
  await sql`update purchase_orders set sent_at = now(), sent_to = ${to} where po_number = ${po_number}`;
  await sql`insert into settings (key, value) values (${"email:" + po!.vendor_key}, ${to}) on conflict (key) do update set value = excluded.value`;
  revalidatePath("/orders");
  revalidatePath("/review");
  redirect(dest({ ok: `${po_number} emailed to ${to}.` }));
}
