/** Reading and changing the master data in Neon: CSV imports, exports, and adding or removing SKUs and distributors. */
import { getSql, type Row } from "./db.ts";
import { toCsv } from "./csv.ts";
import {
  DATASETS, parseDataset, type CalendarRow, type DatasetKind, type DistributorRow, type InventoryRow, type ParseResult, type SalesRow, type SkuRow,
} from "./importers.ts";

export type ImportMode = "upsert" | "replace";

export type ImportReport = {
  kind: DatasetKind;
  ok: boolean;
  imported: number;
  skipped: number; // rows left out (bad rows in the file, or rows pointing at SKUs that do not exist)
  errors: string[];
  notes: string[];
};

const CHUNK = 4000;
async function chunked<T>(rows: T[], fn: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += CHUNK) await fn(rows.slice(i, i + CHUNK));
}

export async function existingSkuIds(): Promise<Set<string>> {
  const rows = await getSql()`select sku_id from skus`;
  return new Set(rows.map((r) => String(r.sku_id)));
}

async function writeSkus(rows: SkuRow[]) {
  const sql = getSql();
  await chunked(rows, (c) => sql`
    insert into skus (sku_id, name, category, perishability, std_reorder_qty, unit, distributor_id, hsn, unit_cost, tax_pct)
    select * from unnest(${c.map((r) => r.sku_id)}::text[], ${c.map((r) => r.name)}::text[], ${c.map((r) => r.category)}::text[],
      ${c.map((r) => r.perishability)}::text[], ${c.map((r) => r.std_reorder_qty)}::int[], ${c.map((r) => r.unit)}::text[],
      ${c.map((r) => r.distributor_id)}::text[], ${c.map((r) => r.hsn)}::text[], ${c.map((r) => r.unit_cost)}::float8[], ${c.map((r) => r.tax_pct)}::float8[])
    on conflict (sku_id) do update set name = excluded.name, category = excluded.category, perishability = excluded.perishability,
      std_reorder_qty = excluded.std_reorder_qty, unit = excluded.unit, distributor_id = excluded.distributor_id, hsn = excluded.hsn,
      unit_cost = excluded.unit_cost, tax_pct = excluded.tax_pct, active = true`);
}

async function writeDistributors(rows: DistributorRow[]) {
  const sql = getSql();
  await chunked(rows, (c) => sql`
    insert into distributors (distributor_id, name, region, status, address, gstin, contact, email)
    select * from unnest(${c.map((r) => r.distributor_id)}::text[], ${c.map((r) => r.name)}::text[], ${c.map((r) => r.region)}::text[],
      ${c.map((r) => r.status)}::text[], ${c.map((r) => r.address)}::text[], ${c.map((r) => r.gstin)}::text[], ${c.map((r) => r.contact)}::text[],
      ${c.map((r) => r.email)}::text[])
    on conflict (distributor_id) do update set name = excluded.name, region = excluded.region, status = excluded.status, address = excluded.address,
      gstin = excluded.gstin, contact = excluded.contact, email = excluded.email`);
}

async function writeSales(rows: SalesRow[]) {
  const sql = getSql();
  await chunked(rows, (c) => sql`
    insert into sales_weekly (sku_id, week, units)
    select * from unnest(${c.map((r) => r.sku_id)}::text[], ${c.map((r) => r.week)}::text[], ${c.map((r) => r.units)}::int[])
    on conflict (sku_id, week) do update set units = excluded.units`);
}

async function writeInventory(rows: InventoryRow[]) {
  const sql = getSql();
  await chunked(rows, (c) => sql`
    insert into inventory_snapshots (sku_id, location, units_on_hand, as_of)
    select * from unnest(${c.map((r) => r.sku_id)}::text[], ${c.map((r) => r.location)}::text[], ${c.map((r) => r.units_on_hand)}::int[],
      ${c.map((r) => r.as_of)}::date[])
    on conflict (sku_id, location, as_of) do update set units_on_hand = excluded.units_on_hand`);
}

async function writeCalendar(rows: CalendarRow[]) {
  const sql = getSql();
  await chunked(rows, (c) => sql`
    insert into calendar_months (year_month, year, month, is_festival)
    select * from unnest(${c.map((r) => r.year_month)}::text[], ${c.map((r) => r.year)}::int[], ${c.map((r) => r.month)}::int[], ${c.map((r) => r.is_festival)}::bool[])
    on conflict (year_month) do update set year = excluded.year, month = excluded.month, is_festival = excluded.is_festival`);
}

/**
 * Import one CSV into Neon. Rows that fail validation (or point at SKUs that do not exist) are skipped and reported;
 * nothing is changed if the columns are wrong. "upsert" adds new rows and updates existing ones; "replace" first empties
 * the dataset (for SKUs: removes SKUs that are not in the file, together with their sales and stock rows).
 */
export async function importDataset(kind: DatasetKind, text: string, mode: ImportMode, by: string, filename: string): Promise<ImportReport> {
  const sql = getSql();
  const parsed = parseDataset(kind, text) as ParseResult<never>;
  const report: ImportReport = { kind, ok: false, imported: 0, skipped: parsed.errorCount, errors: parsed.errors, notes: [] };
  if (parsed.missingColumns.length || (!parsed.rows.length && parsed.errorCount)) return report;
  if (!parsed.rows.length) {
    report.errors.push("The file has a header but no data rows.");
    return report;
  }

  let rows = parsed.rows as unknown[];
  if (kind === "weekly_sales" || kind === "current_inventory") {
    const known = await existingSkuIds();
    const unknown = new Set<string>();
    rows = (rows as (SalesRow | InventoryRow)[]).filter((r) => {
      if (known.has(r.sku_id)) return true;
      unknown.add(r.sku_id);
      return false;
    });
    if (unknown.size) {
      const dropped = (parsed.rows as (SalesRow | InventoryRow)[]).filter((r) => unknown.has(r.sku_id)).length;
      report.skipped += dropped;
      report.notes.push(`${dropped} row(s) skipped because these SKUs are not in the SKU list: ${[...unknown].slice(0, 8).join(", ")}${unknown.size > 8 ? ", ..." : ""}. Add the SKUs first.`);
    }
    if (!rows.length) {
      report.errors.push("No rows matched a known SKU, so nothing was imported.");
      return report;
    }
  }

  if (mode === "replace") {
    if (kind === "sku_master") {
      const keep = (rows as SkuRow[]).map((r) => r.sku_id);
      const removed = await sql`select sku_id from skus where sku_id <> all(${keep}::text[])`;
      if (removed.length) {
        const ids = removed.map((r) => String(r.sku_id));
        await sql`delete from sales_weekly where sku_id = any(${ids}::text[])`;
        await sql`delete from inventory_snapshots where sku_id = any(${ids}::text[])`;
        await sql`delete from skus where sku_id = any(${ids}::text[])`;
        report.notes.push(`${ids.length} SKU(s) not in the file were removed with their sales and stock rows.`);
      }
    } else {
      const table = { distributor_master: "distributors", weekly_sales: "sales_weekly", current_inventory: "inventory_snapshots", calendar: "calendar_months" }[kind];
      await sql.query(`delete from ${table}`);
    }
  }

  switch (kind) {
    case "sku_master": {
      const dists = new Set((await sql`select distributor_id from distributors`).map((r) => String(r.distributor_id)));
      const orphans = [...new Set((rows as SkuRow[]).map((r) => r.distributor_id).filter((d): d is string => !!d && !dists.has(d)))];
      if (orphans.length) report.notes.push(`These distributors are not in the distributor list yet: ${orphans.join(", ")}. Add them so POs show their details.`);
      await writeSkus(rows as SkuRow[]);
      break;
    }
    case "distributor_master": await writeDistributors(rows as DistributorRow[]); break;
    case "weekly_sales": await writeSales(rows as SalesRow[]); break;
    case "current_inventory": await writeInventory(rows as InventoryRow[]); break;
    case "calendar": await writeCalendar(rows as CalendarRow[]); break;
  }
  report.imported = rows.length;
  report.ok = true;
  await sql`insert into data_files (kind, filename, rows, skipped, mode, uploaded_by, note)
            values (${kind}, ${filename}, ${rows.length}, ${report.skipped}, ${mode}, ${by}, ${report.notes.join(" ").slice(0, 400) || null})`;
  return report;
}

/** Current contents of a dataset as CSV text, in the same layout the importer reads. */
export async function exportDataset(kind: DatasetKind): Promise<{ filename: string; csv: string }> {
  const sql = getSql();
  const def = DATASETS[kind];
  let header: string[];
  let body: (string | number | null)[][];
  switch (kind) {
    case "sku_master": {
      const r = await sql`select * from skus where active order by sku_id`;
      header = ["SKU_ID", "SKU_Name", "Category", "Perishability", "Standard_Reorder_Qty", "Unit_of_Measure", "Distributor_ID", "HSN_Code", "Unit_Cost", "Tax_Pct"];
      body = r.map((x) => [x.sku_id, x.name, x.category, x.perishability, x.std_reorder_qty, x.unit, x.distributor_id, x.hsn, x.unit_cost, x.tax_pct]);
      break;
    }
    case "distributor_master": {
      const r = await sql`select * from distributors order by distributor_id`;
      header = ["Distributor_ID", "Distributor_Name", "Region", "Status", "Address", "GSTIN", "Contact", "Email"];
      body = r.map((x) => [x.distributor_id, x.name, x.region, x.status, x.address, x.gstin, x.contact, x.email]);
      break;
    }
    case "weekly_sales": {
      const r = await sql`select sku_id, week, units from sales_weekly order by sku_id, week`;
      header = ["SKU_ID", "Week", "Units_Sold"];
      body = r.map((x) => [x.sku_id, x.week, x.units]);
      break;
    }
    case "current_inventory": {
      const r = await sql`select sku_id, location, units_on_hand, as_of::text as as_of from inventory_snapshots order by as_of, sku_id`;
      header = ["SKU_ID", "Location", "Units_On_Hand", "As_Of_Date"];
      body = r.map((x) => [x.sku_id, x.location, x.units_on_hand, x.as_of]);
      break;
    }
    default: {
      const r = await sql`select * from calendar_months order by year_month`;
      header = ["Year", "Month", "Year_Month", "Is_Festival_Month"];
      body = r.map((x) => [x.year, x.month, x.year_month, x.is_festival ? "TRUE" : "FALSE"]);
    }
  }
  return { filename: def.file, csv: toCsv(header, body) };
}

export type DatasetSummary = { kind: DatasetKind; rows: number; detail: string; lastUpload: { filename: string | null; uploaded_at: string; uploaded_by: string | null } | null };

export async function datasetSummaries(): Promise<DatasetSummary[]> {
  const sql = getSql();
  const [skus, dists, sales, inv, cal, files] = await Promise.all([
    sql`select count(*) filter (where active) as n, count(*) filter (where active and perishability = 'High') as hi from skus`,
    sql`select count(*) as n from distributors`,
    sql`select count(*) as n, min(week) as first, max(week) as last, count(distinct week) as weeks from sales_weekly`,
    sql`select count(*) as n, max(as_of)::text as latest, count(distinct as_of) as dates from inventory_snapshots`,
    sql`select count(*) as n, count(*) filter (where is_festival) as fest from calendar_months`,
    sql`select distinct on (kind) kind, filename, uploaded_at, uploaded_by from data_files order by kind, uploaded_at desc`,
  ]);
  const last = new Map(files.map((f) => [String(f.kind), { filename: f.filename as string | null, uploaded_at: new Date(f.uploaded_at).toISOString(), uploaded_by: f.uploaded_by as string | null }]));
  const n = (r: Row[], k = "n") => Number(r[0]?.[k] ?? 0);
  return [
    { kind: "sku_master", rows: n(skus), detail: `${n(skus, "hi")} high-perishability`, lastUpload: last.get("sku_master") ?? null },
    { kind: "distributor_master", rows: n(dists), detail: "", lastUpload: last.get("distributor_master") ?? null },
    { kind: "weekly_sales", rows: n(sales), detail: sales[0]?.first ? `${n(sales, "weeks")} weeks, ${sales[0].first} to ${sales[0].last}` : "", lastUpload: last.get("weekly_sales") ?? null },
    { kind: "current_inventory", rows: n(inv), detail: inv[0]?.latest ? `${n(inv, "dates")} date(s), latest ${inv[0].latest}` : "", lastUpload: last.get("current_inventory") ?? null },
    { kind: "calendar", rows: n(cal), detail: `${n(cal, "fest")} festival month(s)`, lastUpload: last.get("calendar") ?? null },
  ];
}

// ---------- single SKU / distributor edits ----------
export type SkuInput = Omit<SkuRow, "perishability"> & { perishability: string };

export async function saveSku(input: SkuInput): Promise<string | null> {
  const parsed = parseDataset("sku_master", toCsv(
    ["SKU_ID", "SKU_Name", "Category", "Perishability", "Standard_Reorder_Qty", "Unit_of_Measure", "Distributor_ID", "HSN_Code", "Unit_Cost", "Tax_Pct"],
    [[input.sku_id, input.name, input.category, input.perishability, input.std_reorder_qty, input.unit, input.distributor_id, input.hsn, input.unit_cost, input.tax_pct]],
  ));
  if (parsed.errorCount) return parsed.errors[0].replace(/^Row \d+: /, "");
  await writeSkus(parsed.rows);
  return null;
}

/** Remove a SKU. With `withData`, its sales and stock history go too; otherwise it is only switched off. */
export async function removeSku(skuId: string, withData: boolean) {
  const sql = getSql();
  if (withData) {
    await sql`delete from sales_weekly where sku_id = ${skuId}`;
    await sql`delete from inventory_snapshots where sku_id = ${skuId}`;
    await sql`delete from skus where sku_id = ${skuId}`;
  } else {
    await sql`update skus set active = false where sku_id = ${skuId}`;
  }
}

export async function saveDistributor(input: DistributorRow): Promise<string | null> {
  const parsed = parseDataset("distributor_master", toCsv(
    ["Distributor_ID", "Distributor_Name", "Region", "Status", "Address", "GSTIN", "Contact", "Email"],
    [[input.distributor_id, input.name, input.region, input.status, input.address, input.gstin, input.contact, input.email]],
  ));
  if (parsed.errorCount) return parsed.errors[0].replace(/^Row \d+: /, "");
  await writeDistributors(parsed.rows);
  return null;
}

/** Returns an error message if SKUs still use this distributor. */
export async function removeDistributor(id: string): Promise<string | null> {
  const sql = getSql();
  const used = await sql`select count(*) as n from skus where active and distributor_id = ${id}`;
  if (Number(used[0].n) > 0) return `${used[0].n} active SKU(s) are still ordered from this distributor. Move them first.`;
  await sql`delete from distributors where distributor_id = ${id}`;
  return null;
}
