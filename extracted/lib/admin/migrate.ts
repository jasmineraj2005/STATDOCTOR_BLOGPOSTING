import "server-only";

import { promises as fs } from "fs";
import path from "path";
import { sql, isDbConfigured } from "./db";

/** Apply schema.sql idempotently. Safe to call on every cold start. */
export async function applyMigrations(): Promise<{ ok: boolean; detail: string }> {
  if (!isDbConfigured()) {
    return { ok: false, detail: "POSTGRES_URL not set; skipping migration." };
  }
  const schemaPath = path.join(process.cwd(), "lib", "admin", "schema.sql");
  let schema: string;
  try {
    schema = await fs.readFile(schemaPath, "utf-8");
  } catch (e) {
    return { ok: false, detail: `Could not read schema.sql: ${String(e)}` };
  }
  // @vercel/postgres exposes a low-level query that accepts a raw string.
  // The tagged-template `sql` doesn't accept multi-statement DDL, so use the
  // sql.query API (also from the same package) to apply the file as-is.
  try {
    // Split on `;` boundary (very simple — schema.sql has no procedural blocks).
    const statements = schema
      .split(/;\s*\n/)
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith("--"));
    for (const stmt of statements) {
      await sql.query(stmt);
    }
    return { ok: true, detail: `Applied ${statements.length} statement(s).` };
  } catch (e) {
    return { ok: false, detail: `Migration failed: ${String(e)}` };
  }
}
