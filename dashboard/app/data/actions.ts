"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { DATASETS, type DatasetKind } from "@/lib/importers";
import { importDataset, removeDistributor, removeSku, saveDistributor, saveSku, type ImportMode } from "@/lib/store";

const MAX_BYTES = 4 * 1024 * 1024;
const go = (path: string, p: Record<string, string>) => redirect(`${path}?${new URLSearchParams(p).toString()}`);
const who = async () => ((await cookies()).get("dp_user")?.value || "someone").slice(0, 60);
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const numOrNull = (v: string) => (v === "" ? null : Number(v));

function refresh() {
  for (const p of ["/", "/data", "/data/skus", "/data/distributors", "/review"]) revalidatePath(p);
}

/** Upload one CSV into Neon (add/update rows, or replace the whole dataset). */
export async function uploadDataset(formData: FormData) {
  const kind = str(formData, "kind") as DatasetKind;
  if (!(kind in DATASETS)) go("/data", { error: "Unknown dataset." });
  const mode: ImportMode = str(formData, "mode") === "replace" ? "replace" : "upsert";
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) go("/data", { error: `Choose a ${DATASETS[kind].file} file first.` });
  const f = file as File;
  if (f.size > MAX_BYTES) go("/data", { error: `That file is ${(f.size / 1048576).toFixed(1)} MB. The limit is 4 MB: split it into two uploads (adding rows works in several steps).` });
  if (mode === "replace" && str(formData, "confirm") !== "yes") go("/data", { error: "Tick the box to confirm that replacing removes what is there now." });

  const r = await importDataset(kind, await f.text(), mode, await who(), f.name);
  refresh();
  if (!r.ok) go("/data", { error: [`${DATASETS[kind].label}: nothing was imported.`, ...r.errors.slice(0, 6)].join(" | ") });
  go("/data", {
    ok: `${DATASETS[kind].label}: ${r.imported} row(s) ${mode === "replace" ? "loaded (replacing the old data)" : "added or updated"}${r.skipped ? `, ${r.skipped} skipped` : ""}.` +
      (r.notes.length ? ` ${r.notes.join(" ")}` : "") + (r.errors.length ? ` | ${r.errors.slice(0, 4).join(" | ")}` : ""),
  });
}

export async function saveSkuAction(formData: FormData) {
  const err = await saveSku({
    sku_id: str(formData, "sku_id"), name: str(formData, "name"), category: str(formData, "category") || null,
    perishability: str(formData, "perishability"), std_reorder_qty: Number(str(formData, "std_reorder_qty") || "0"),
    unit: str(formData, "unit") || null, distributor_id: str(formData, "distributor_id") || null, hsn: str(formData, "hsn") || null,
    unit_cost: numOrNull(str(formData, "unit_cost")), tax_pct: numOrNull(str(formData, "tax_pct")),
  });
  refresh();
  if (err) go("/data/skus", { error: err });
  go("/data/skus", { ok: `${str(formData, "sku_id")} saved.` });
}

export async function removeSkuAction(formData: FormData) {
  const id = str(formData, "sku_id");
  const withData = str(formData, "with_data") === "yes";
  await removeSku(id, withData);
  refresh();
  go("/data/skus", { ok: withData ? `${id} removed with its sales and stock history.` : `${id} switched off. Its history is kept; add it again to switch it back on.` });
}

export async function saveDistributorAction(formData: FormData) {
  const err = await saveDistributor({
    distributor_id: str(formData, "distributor_id"), name: str(formData, "name"), region: str(formData, "region") || null,
    status: str(formData, "status") || "Active", address: str(formData, "address") || null, gstin: str(formData, "gstin") || null,
    contact: str(formData, "contact") || null, email: str(formData, "email") || null,
  });
  refresh();
  if (err) go("/data/distributors", { error: err });
  go("/data/distributors", { ok: `${str(formData, "distributor_id")} saved.` });
}

export async function removeDistributorAction(formData: FormData) {
  const err = await removeDistributor(str(formData, "distributor_id"));
  refresh();
  if (err) go("/data/distributors", { error: err });
  go("/data/distributors", { ok: `${str(formData, "distributor_id")} removed.` });
}
