import Link from "next/link";
import { dbConfigured, getSql } from "@/lib/db";
import { NotConnected } from "@/components/NotConnected";
import { removeDistributorAction, saveDistributorAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function DistributorsPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const { error, ok } = await searchParams;
  if (!dbConfigured()) return <NotConnected />;
  const dists = await getSql()`
    select d.*, (select count(*) from skus s where s.active and s.distributor_id = d.distributor_id) as sku_count
    from distributors d order by d.distributor_id`;

  return (
    <>
      <p className="small"><Link href="/data">← Data</Link></p>
      <h1>Distributors</h1>
      <p className="sub">The vendors SKUs are ordered from. Their address, GSTIN and contact appear on the purchase order, and the email pre-fills the &quot;Send by email&quot; box.</p>
      {error ? <div className="banner bad" role="alert">{error}</div> : null}
      {ok ? <div className="banner good" role="status">{ok}</div> : null}

      <section className="card">
        <h2>Add a distributor</h2>
        <form action={saveDistributorAction} className="reviewcontrols">
          <label className="small dim">Id<input name="distributor_id" type="text" required placeholder="DIST005" /></label>
          <label className="small dim" style={{ flex: 1, minWidth: 200 }}>Name<input name="name" type="text" required /></label>
          <label className="small dim">Region<input name="region" type="text" /></label>
          <label className="small dim" style={{ flex: 1, minWidth: 220 }}>Address<input name="address" type="text" /></label>
          <label className="small dim">GSTIN<input name="gstin" type="text" /></label>
          <label className="small dim">Contact<input name="contact" type="text" /></label>
          <label className="small dim">Email<input name="email" type="email" /></label>
          <button className="btn primary" type="submit">Add distributor</button>
        </form>
      </section>

      <section className="card">
        <h2>Current distributors ({dists.length})</h2>
        <div className="tablewrap">
          <table>
            <thead><tr><th>Id</th><th>Name</th><th>Region</th><th>Address</th><th>GSTIN</th><th>Contact</th><th>Email</th><th>SKUs</th><th></th></tr></thead>
            <tbody>
              {dists.map((d) => (
                <tr key={String(d.distributor_id)} className="editrow">
                  <td colSpan={9} style={{ padding: 0 }}>
                    <form action={saveDistributorAction} style={{ display: "grid", gridTemplateColumns: "84px 1.4fr 1fr 1.6fr 1fr 1fr 1.3fr 48px auto", gap: 6, padding: "6px 10px", alignItems: "center" }}>
                      <input type="hidden" name="distributor_id" value={String(d.distributor_id)} />
                      <input type="hidden" name="status" value={String(d.status)} />
                      <strong>{String(d.distributor_id)}</strong>
                      <input name="name" type="text" defaultValue={String(d.name)} required aria-label={`${d.distributor_id} name`} />
                      <input name="region" type="text" defaultValue={d.region ?? ""} aria-label={`${d.distributor_id} region`} />
                      <input name="address" type="text" defaultValue={d.address ?? ""} aria-label={`${d.distributor_id} address`} />
                      <input name="gstin" type="text" defaultValue={d.gstin ?? ""} aria-label={`${d.distributor_id} GSTIN`} />
                      <input name="contact" type="text" defaultValue={d.contact ?? ""} aria-label={`${d.distributor_id} contact`} />
                      <input name="email" type="email" defaultValue={d.email ?? ""} aria-label={`${d.distributor_id} email`} />
                      <span className="dim">{Number(d.sku_count)}</span>
                      <span className="btns" style={{ flexWrap: "nowrap" }}>
                        <button className="btn" type="submit">Save</button>
                        <button className="btn bad" type="submit" formAction={removeDistributorAction}>Remove</button>
                      </span>
                    </form>
                  </td>
                </tr>
              ))}
              {!dists.length ? <tr><td colSpan={9} className="dim">No distributors yet.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
