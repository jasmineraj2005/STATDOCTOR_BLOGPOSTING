import "server-only";

import { promises as fs } from "fs";
import path from "path";
import { rawQuery, isDbConfigured } from "./db";

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
  try {
    // Strip line comments first, then split on `;` boundary.
    const cleaned = schema
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    const statements = cleaned
      .split(/;\s*\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const stmt of statements) {
      await rawQuery(stmt);
    }
    return { ok: true, detail: `Applied ${statements.length} statement(s).` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, detail: `Migration failed: ${msg}` };
  }
}
