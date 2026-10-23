import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Row, Sql } from "./db.ts";

/** In-memory Postgres with the real schema, behind the same tagged-template interface as Neon. Tests only. */
// Kept on globalThis so every server bundle (pages, actions, route handlers) talks to the same in-memory database.
const g = globalThis as unknown as { __dpPglite?: Promise<PGlite> };

function database(): Promise<PGlite> {
  g.__dpPglite ??= (async () => {
    const pg = new PGlite();
    await pg.exec(readFileSync(path.join(process.cwd(), "db", "schema.sql"), "utf8"));
    return pg;
  })();
  return g.__dpPglite;
}

export function makePgliteSql(): Sql {
  const run = async (text: string, params: unknown[] = []): Promise<Row[]> => (await (await database()).query(text, params)).rows as Row[];
  const tag = ((strings: TemplateStringsArray, ...values: unknown[]) =>
    run(strings.reduce((acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ""), ""), values)) as Sql;
  tag.query = run;
  return tag;
}
