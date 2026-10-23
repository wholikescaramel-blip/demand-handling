/** Shown instead of a page when the database is not connected yet. */
export function NotConnected() {
  return (
    <section className="card" style={{ maxWidth: 720, marginTop: 24 }}>
      <h1 style={{ marginTop: 0 }}>Connect the database to begin</h1>
      <p>
        This dashboard keeps everything in a Neon database: the SKUs, sales, stock, rules, recommendations, decisions and purchase orders. It is not
        connected yet.
      </p>
      <ol style={{ paddingLeft: 20 }}>
        <li>In Neon, copy the <strong>pooled connection string</strong> (Connect &gt; Connection pooling on).</li>
        <li>In the Vercel project add it as <code>DATABASE_URL</code>, together with <code>DASHBOARD_PASSWORD</code> (the team password).</li>
        <li>Redeploy. The build creates the tables by itself. Then open <strong>Data</strong> and upload your CSV files.</li>
      </ol>
    </section>
  );
}
