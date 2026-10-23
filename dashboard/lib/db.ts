import { neon } from "@neondatabase/serverless";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;

export type Sql = {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<Row[]>;
  query(text: string, params?: unknown[]): Promise<Row[]>;
};

/** True when the dashboard has a database to talk to. DP_TEST_PGLITE is an in-memory Postgres used only by the tests. */
export const dbConfigured = () => Boolean(process.env.DATABASE_URL || process.env.DP_TEST_PGLITE);

let cached: Sql | null = null;

/** The one door to the database: Neon in production, an in-memory Postgres in tests. */
export function getSql(): Sql {
  if (cached) return cached;
  if (process.env.DP_TEST_PGLITE) {
    // Lazy, so the PGlite engine is only ever loaded by the test runs.
    let inner: Promise<Sql> | null = null;
    const load = () => (inner ??= import("./db-pglite.ts").then((m) => m.makePgliteSql()));
    const tag = (async (strings: TemplateStringsArray, ...values: unknown[]) => (await load())(strings, ...values)) as Sql;
    tag.query = async (text, params) => (await load()).query(text, params);
    cached = tag;
    return cached;
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  cached = neon(process.env.DATABASE_URL) as unknown as Sql;
  return cached;
}
