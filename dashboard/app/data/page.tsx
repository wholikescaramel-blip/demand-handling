import Link from "next/link";
import { dbConfigured } from "@/lib/db";
import { DATASETS, type DatasetKind } from "@/lib/importers";
import { datasetSummaries } from "@/lib/store";
import { fmtDateTime } from "@/components/ui";
import { NotConnected } from "@/components/NotConnected";
import { uploadDataset } from "./actions";

export const dynamic = "force-dynamic";

const ORDER: DatasetKind[] = ["distributor_master", "sku_master", "weekly_sales", "current_inventory", "calendar"];

export default async function DataPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const { error, ok } = await searchParams;
  if (!dbConfigured()) return <NotConnected />;
  const summaries = new Map((await datasetSummaries()).map((s) => [s.kind, s]));
  const lines = (s?: string) => (s ?? "").split(" | ");

  return (
    <>
      <h1>Data</h1>
      <p className="sub">
        Everything the rules read lives in Neon, and you change it here: upload a CSV for any dataset, download what is there now, or add and remove
        individual SKUs and distributors. The next planning run uses whatever is here.
      </p>

      {error ? (
        <div className="banner bad" role="alert">
          {lines(error)[0]}
          {lines(error).length > 1 ? <ul className="errlist">{lines(error).slice(1).map((e, i) => <li key={i}>{e}</li>)}</ul> : null}
        </div>
      ) : null}
      {ok ? (
        <div className="banner good" role="status">
          {lines(ok)[0]}
          {lines(ok).length > 1 ? <ul className="errlist">{lines(ok).slice(1).map((e, i) => <li key={i}>{e}</li>)}</ul> : null}
        </div>
      ) : null}

      <section className="card">
        <h2>Add or remove individual items</h2>
        <div className="btns">
          <Link className="btn primary" href="/data/skus">Manage SKUs</Link>
          <Link className="btn primary" href="/data/distributors">Manage distributors</Link>
        </div>
        <p className="small dim" style={{ marginBottom: 0 }}>Upload in this order the first time: distributors, SKUs, then sales, stock and the calendar. Sales and stock rows for a SKU that does not exist are skipped.</p>
      </section>

      <div className="datasets">
        {ORDER.map((kind) => {
          const d = DATASETS[kind];
          const s = summaries.get(kind);
          return (
            <section key={kind} className="card">
              <h2>{d.label}</h2>
              <p style={{ margin: "0 0 6px" }}>{d.blurb}</p>
              <div className="small dim">
                <strong style={{ color: "var(--text)" }}>{s?.rows ?? 0}</strong> row(s) in Neon{s?.detail ? ` · ${s.detail}` : ""}.
                {s?.lastUpload ? ` Last upload ${fmtDateTime(s.lastUpload.uploaded_at)}${s.lastUpload.filename ? ` (${s.lastUpload.filename})` : ""}${s.lastUpload.uploaded_by ? ` by ${s.lastUpload.uploaded_by}` : ""}.` : " Nothing uploaded yet."}
              </div>
              <div className="small colchips">
                <span className="dim">Columns:</span>
                {d.required.map((c) => <span key={c} className="code">{c}</span>)}
                {d.optional.map((c) => <span key={c} className="code dim">{c}</span>)}
                <span className="dim">(grey ones are optional)</span>
              </div>

              <form action={uploadDataset} className="upload">
                <input type="hidden" name="kind" value={kind} />
                <input type="file" name="file" accept=".csv,text/csv" required />
                <div className="row">
                  <label className="small">
                    <select name="mode" defaultValue="upsert">
                      <option value="upsert">Add new rows and update existing ones</option>
                      <option value="replace">Replace everything with this file</option>
                    </select>
                  </label>
                  <label className="small dim"><input type="checkbox" name="confirm" value="yes" /> I understand replacing removes what is there now</label>
                </div>
                <div className="btns">
                  <button className="btn primary" type="submit">Upload {d.file}</button>
                  <a className="btn" href={`/api/data/export?kind=${kind}`}>Download current</a>
                  <a className="btn" href={`/api/data/export?kind=${kind}&template=1`}>Blank template</a>
                </div>
              </form>
            </section>
          );
        })}
      </div>
    </>
  );
}
