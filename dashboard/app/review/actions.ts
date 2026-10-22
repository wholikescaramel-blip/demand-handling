"use server";

import { neon } from "@neondatabase/serverless";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { checkDecision } from "@/lib/po";
import { generateIfRunComplete, generatePosForReady } from "@/lib/orders";

const back = (params: Record<string, string>) => `/review?${new URLSearchParams(params).toString()}`;

async function reviewerName(): Promise<string> {
  const jar = await cookies();
  return (jar.get("dp_user")?.value || "reviewer").slice(0, 60);
}

/** Approve / Override / Reject one recommendation. First decision wins; it cannot be changed afterwards. */
export async function decide(formData: FormData) {
  if (!process.env.DATABASE_URL) redirect(back({ error: "Demo mode: connect a database to record decisions." }));
  const sql = neon(process.env.DATABASE_URL!);
  const run_id = String(formData.get("run_id") ?? "");
  const sku = String(formData.get("sku") ?? "");

  const [rec] = await sql`
    select r.action, r.rec_qty, r.flags, r.priority, u.run_at, u.mode
    from recommendations r join runs u on u.run_id = r.run_id
    where r.run_id = ${run_id} and r.sku = ${sku}`;
  if (!rec) redirect(back({ error: "That recommendation no longer exists.", sku }));
  if (rec.mode !== "LIVE") redirect(back({ error: "This run was in shadow mode: nothing to decide.", sku }));

  const check = checkDecision({
    action: rec.action,
    recQty: rec.rec_qty === null ? null : Number(rec.rec_qty),
    decision: String(formData.get("decision") ?? ""),
    overrideQty: String(formData.get("override_qty") ?? ""),
    reason: String(formData.get("reason") ?? ""),
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

  // Last decision of the run? Then its approved lines become purchase orders straight away.
  const gen = await generateIfRunComplete(run_id);

  revalidatePath("/review");
  revalidatePath("/orders");
  revalidatePath("/");
  const verb = { Approve: "approved", Override: "overridden", Reject: "rejected" }[check.decision];
  const made = gen?.created.length
    ? ` All lines decided: ${gen.created.length} purchase order(s) generated (${gen.created.map((c) => c.po_number).join(", ")}).`
    : "";
  redirect(back({ ok: `${sku} ${verb}.${made}` }));
}

/** For a partial review (for example end of day): generate POs for what is approved so far. */
export async function generatePos() {
  if (!process.env.DATABASE_URL) redirect("/orders?error=" + encodeURIComponent("Demo mode: connect a database first."));
  const r = await generatePosForReady();
  revalidatePath("/orders");
  revalidatePath("/review");
  if (r.failed.length) redirect("/orders?error=" + encodeURIComponent(r.failed.map((f) => `${f.vendor}: ${f.error}`).join("; ")));
  redirect(`/orders?created=${r.created.length}`);
}

/** Goods arrived: the PO stops counting as stock on order. */
export async function markReceived(formData: FormData) {
  if (!process.env.DATABASE_URL) redirect("/orders?error=" + encodeURIComponent("Demo mode: connect a database first."));
  const sql = neon(process.env.DATABASE_URL!);
  await sql`update purchase_orders set received_at = now() where po_number = ${String(formData.get("po_number") ?? "")} and received_at is null`;
  revalidatePath("/orders");
  redirect("/orders");
}
