"use server";

import { neon } from "@neondatabase/serverless";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { checkDecision } from "@/lib/po";
import { createPosForReady } from "@/lib/orders";

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

  revalidatePath("/review");
  revalidatePath("/");
  const verb = { Approve: "approved", Override: "overridden", Reject: "rejected" }[check.decision];
  redirect(back({ ok: `${sku} ${verb}.` }));
}

/** One PO per vendor for everything approved and not yet ordered (also retries failures). */
export async function createPos() {
  if (!process.env.DATABASE_URL) redirect("/orders?error=" + encodeURIComponent("Demo mode: connect a database and Zoho first."));
  const r = await createPosForReady();
  revalidatePath("/orders");
  revalidatePath("/review");
  if (!r.configured) redirect("/orders?error=" + encodeURIComponent("Zoho is not configured. Add the ZOHO_* variables, then try again."));
  redirect(`/orders?created=${r.created.length}&failed=${r.failed.length}`);
}
