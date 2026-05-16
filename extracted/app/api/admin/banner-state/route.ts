/**
 * GET /api/admin/banner-state
 *
 * Returns the current banner state for the admin dashboard.
 * Used by the Playwright spec (D6) and will be consumed by the UI in a follow-up.
 *
 * Response shape:
 *   { state: BannerState }
 *
 * Authorization: admin cookie
 */

import { NextResponse } from "next/server";
import { isAuthorised } from "@/lib/admin/auth";
import { computeBannerState } from "@/lib/admin/banner";
import { pool, isDbConfigured } from "@/lib/admin/db";
import type { BannerDb } from "@/lib/admin/banner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request) {
  const authorised = await isAuthorised();
  if (!authorised) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!isDbConfigured()) {
    return NextResponse.json({ state: { kind: "none" } });
  }

  const p = pool();
  const db: BannerDb = {
    query: async (text, values) => {
      const res = await p.query(text, values);
      return { rows: res.rows };
    },
  };

  const state = await computeBannerState(db, new Date());
  return NextResponse.json({ state });
}
