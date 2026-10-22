import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

// `--if-configured` is used by the Vercel build: skip quietly until DATABASE_URL has been added.
const optional = process.argv.includes("--if-configured");
const url = process.env.DATABASE_URL;
if (!url) {
  if (optional) {
    console.log("DATABASE_URL not set: skipping database migration (add it in Vercel, then redeploy).");
    process.exit(0);
  }
  console.error("Set DATABASE_URL first (Neon connection string).");
  process.exit(1);
}
const sql = neon(url);
// Strip comments first (inline ones too), then split on semicolons. The schema has no string literal containing ';' or '--'.
const statements = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8")
  .replace(/--[^\n]*/g, "")
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean);

for (const s of statements) await sql.query(s);
console.log(`Applied ${statements.length} statements.`);
