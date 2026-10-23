import Link from "next/link";
import { dbConfigured, getSql } from "@/lib/db";
import { NotConnected } from "@/components/NotConnected";
import { removeSkuAction, saveSkuAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function SkusPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const { error, ok } = await searchParams;
  if (!dbConfigured()) return <NotConnected />;
  const sql = getSql();
  const [skus, dists] = await Promise.all([
    sql`select * from skus where active order by sku_id`,
    sql`select distributor_id, name from distributors order by name`,
  ]);

  const distSelect = (name: string, value: string | null) => (
    <select name={name} defaultValue={value ?? ""}>
      <option value="">(none)</option>
      {dists.map((d) => <option key={String(d.distributor_id)} value={String(d.distributor_id)}>{String(d.name)}</option>)}
    </select>
  );

  return (
    <>
      <p className="small"><Link href="/data">← Data</Link></p>
      <h1>SKUs</h1>
      <p className="sub">Add a SKU, change one, or remove one. Removing can keep its sales and stock history (it is just switched off) or delete it all.</p>
      {error ? <div className="banner bad" role="alert">{error}</div> : null}
      {ok ? <div className="banner good" role="status">{ok}</div> : null}

      <section className="card">
        <h2>Add a SKU</h2>
        <form action={saveSkuAction} className="reviewcontrols">
          <label className="small dim">SKU id<input name="sku_id" type="text" required placeholder="SKU016" /></label>
          <label className="small dim grow" style={{ flex: 1, minWidth: 220 }}>Name<input name="name" type="text" required placeholder="Freshroots Mixed Fruit Jam 250g" /></label>
          <label className="small dim">Category<input name="category" type="text" placeholder="Spread" /></label>
          <label className="small dim">Perishability
            <select name="perishability" defaultValue="Low"><option>Low</option><option>High</option></select>
          </label>
          <label className="small dim">Standard reorder qty<input name="std_reorder_qty" type="number" min={0} step={1} required defaultValue={100} /></label>
          <label className="small dim">Unit<input name="unit" type="text" placeholder="Units" /></label>
          <label className="small dim">Distributor{distSelect("distributor_id", null)}</label>
          <label className="small dim">HSN code<input name="hsn" type="text" /></label>
          <label className="small dim">Unit cost (Rs)<input name="unit_cost" type="number" min={0} step="0.01" /></label>
          <label className="small dim">Tax %<input name="tax_pct" type="number" min={0} max={100} step="0.01" /></label>
          <button className="btn primary" type="submit">Add SKU</button>
        </form>
        <p className="small dim" style={{ marginBottom: 0 }}>A new SKU has no sales history yet, so the rules send it to Raghav as a manual review until it has 12 weeks. Upload its sales on the Data page.</p>
      </section>

      <section className="card">
        <h2>Current SKUs ({skus.length})</h2>
        <div className="tablewrap">
          <table>
            <thead><tr><th>SKU</th><th>Name</th><th>Category</th><th>Perishability</th><th>Std qty</th><th>Unit</th><th>Distributor</th><th>HSN</th><th>Cost</th><th>Tax %</th><th></th></tr></thead>
            <tbody>
              {skus.map((s) => (
                <tr key={String(s.sku_id)} className="editrow">
                  <td colSpan={11} style={{ padding: 0 }}>
                    <form action={saveSkuAction} style={{ display: "grid", gridTemplateColumns: "88px 1.6fr 1fr 96px 80px 70px 1.2fr 90px 80px 64px auto", gap: 6, padding: "6px 10px", alignItems: "center" }}>
                      <input type="hidden" name="sku_id" value={String(s.sku_id)} />
                      <strong>{String(s.sku_id)}</strong>
                      <input name="name" type="text" defaultValue={String(s.name)} required aria-label={`${s.sku_id} name`} />
                      <input name="category" type="text" defaultValue={s.category ?? ""} aria-label={`${s.sku_id} category`} />
                      <select name="perishability" defaultValue={String(s.perishability)} aria-label={`${s.sku_id} perishability`}><option>Low</option><option>High</option></select>
                      <input name="std_reorder_qty" type="number" min={0} step={1} defaultValue={Number(s.std_reorder_qty)} aria-label={`${s.sku_id} standard qty`} />
                      <input name="unit" type="text" defaultValue={s.unit ?? ""} aria-label={`${s.sku_id} unit`} />
                      {distSelect("distributor_id", s.distributor_id ?? null)}
                      <input name="hsn" type="text" defaultValue={s.hsn ?? ""} aria-label={`${s.sku_id} HSN`} />
                      <input name="unit_cost" type="number" min={0} step="0.01" defaultValue={s.unit_cost ?? ""} aria-label={`${s.sku_id} unit cost`} />
                      <input name="tax_pct" type="number" min={0} max={100} step="0.01" defaultValue={s.tax_pct ?? ""} aria-label={`${s.sku_id} tax`} />
                      <span className="btns" style={{ flexWrap: "nowrap" }}>
                        <button className="btn" type="submit">Save</button>
                        <button className="btn bad" type="submit" formAction={removeSkuAction} title="Switch this SKU off (history kept)">Remove</button>
                      </span>
                    </form>
                  </td>
                </tr>
              ))}
              {!skus.length ? <tr><td colSpan={11} className="dim">No SKUs yet. Add one above or upload sku_master.csv on the Data page.</td></tr> : null}
            </tbody>
          </table>
        </div>
        <p className="small dim" style={{ marginBottom: 0 }}>
          Remove switches a SKU off but keeps its sales and stock history, so adding it again brings the history back. To delete a SKU together with its
          history, upload an updated sku_master.csv on the Data page using &quot;Replace everything&quot;.
        </p>
      </section>
    </>
  );
}
