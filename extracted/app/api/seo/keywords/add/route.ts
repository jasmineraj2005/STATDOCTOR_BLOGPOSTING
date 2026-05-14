import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { isAuthorised } from "@/lib/admin/auth";
import { sql, isDbConfigured } from "@/lib/admin/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!(await isAuthorised())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isDbConfigured()) {
    return NextResponse.json({ error: "db_not_configured" }, { status: 500 });
  }
  const form = await req.formData();
  const keyword = String(form.get("keyword") ?? "").trim().slice(0, 200);
  const pillar = String(form.get("pillar") ?? "").trim().slice(0, 80);
  if (!keyword || !pillar) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  await sql`
    INSERT INTO keyword_targets (keyword, pillar)
    VALUES (${keyword}, ${pillar})
    ON CONFLICT (keyword) DO UPDATE SET pillar = EXCLUDED.pillar
  `;
  redirect("/admin/seo/keywords");
}
