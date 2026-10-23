// Loads the five CSV files into Neon (the same code the Data page's upload uses).
//   npm run seed                      reads ../sku_master.csv, ../weekly_sales.csv ... from the repo root
//   npm run seed -- path/to/folder    reads them from another folder
// Safe to run again: rows are added or updated, nothing is duplicated.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { DATASETS, type DatasetKind } from "../lib/importers.ts";
import { importDataset } from "../lib/store.ts";

if (!process.env.DATABASE_URL) {
  console.error("Set DATABASE_URL first (npm run seed reads it from .env.local).");
  process.exit(1);
}
const dir = path.resolve(process.argv[2] ?? path.join(process.cwd(), ".."));
const order: DatasetKind[] = ["distributor_master", "sku_master", "weekly_sales", "current_inventory", "calendar"];

for (const kind of order) {
  const file = path.join(dir, DATASETS[kind].file);
  if (!existsSync(file)) {
    console.log(`skip   ${DATASETS[kind].file} (not found in ${dir})`);
    continue;
  }
  const r = await importDataset(kind, readFileSync(file, "utf8"), "upsert", "seed script", DATASETS[kind].file);
  console.log(`${r.ok ? "loaded" : "FAILED"} ${DATASETS[kind].file}: ${r.imported} row(s)${r.skipped ? `, ${r.skipped} skipped` : ""}`);
  for (const e of r.errors.slice(0, 5)) console.log(`         ${e}`);
  for (const n of r.notes) console.log(`         ${n}`);
  if (!r.ok) process.exitCode = 1;
}
