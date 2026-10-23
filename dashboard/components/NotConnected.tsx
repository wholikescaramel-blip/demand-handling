/** Shown instead of a page when the database is not connected yet. */
export function NotConnected() {
  return (
    <section className="card" style={{ maxWidth: 720, marginTop: 24 }}>
      <h1 style={{ marginTop: 0 }}>Database not connected</h1>
      <p>
        Everything (SKUs, sales, stock, rules, recommendations, decisions, purchase orders) lives in the Neon database, and the dashboard cannot
        reach it. Check that <code>DATABASE_URL</code> is set in the Vercel project (pooled connection string) and redeploy.
      </p>
    </section>
  );
}
