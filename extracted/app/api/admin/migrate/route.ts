import { NextResponse } from "next/server";
import { isAuthorised } from "@/lib/admin/auth";
import { applyMigrations } from "@/lib/admin/migrate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Apply schema.sql to Vercel Postgres. Idempotent (CREATE TABLE IF NOT EXISTS).
 * Gated by ADMIN_TOKEN — must be invoked while signed in.
 *
 *   POST /api/admin/migrate
 */
export async function POST() {
  if (!(await isAuthorised())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await applyMigrations();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
