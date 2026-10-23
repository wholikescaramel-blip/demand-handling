import { NextResponse } from "next/server";
import { dbConfigured } from "@/lib/db";
import { toCsv } from "@/lib/csv";
import { DATASETS, type DatasetKind } from "@/lib/importers";
import { exportDataset } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Download a dataset as CSV (the current contents), or `&template=1` for an empty file with just the header row. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") as DatasetKind;
  if (!(kind in DATASETS)) return new NextResponse("Unknown dataset", { status: 400 });
  if (!dbConfigured()) return new NextResponse("The database is not connected", { status: 503 });

  const def = DATASETS[kind];
  const { filename, csv } = url.searchParams.get("template") ? { filename: `template_${def.file}`, csv: toCsv([...def.required, ...def.optional], []) } : await exportDataset(kind);
  return new NextResponse(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" },
  });
}
