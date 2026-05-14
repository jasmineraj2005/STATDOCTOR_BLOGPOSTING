import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { isAuthorised } from "@/lib/admin/auth";
import { sql, isDbConfigured } from "@/lib/admin/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VALID_MODELS = new Set([
  "chatgpt",
  "claude",
  "perplexity",
  "gemini",
  "copilot",
  "other",
]);

export async function POST(req: Request) {
  if (!(await isAuthorised())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isDbConfigured()) {
    return NextResponse.json({ error: "db_not_configured" }, { status: 500 });
  }
  const form = await req.formData();
  const keyword = String(form.get("keyword") ?? "").trim().slice(0, 200);
  const model = String(form.get("model") ?? "").trim();
  const cited = String(form.get("cited") ?? "") === "true";
  const snippet = String(form.get("snippet") ?? "").slice(0, 2000);
  const notes = String(form.get("notes") ?? "").slice(0, 500);

  if (!keyword || !VALID_MODELS.has(model)) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  await sql`
    INSERT INTO aeo_log (keyword, model, cited, snippet, notes)
    VALUES (${keyword}, ${model}, ${cited}, ${snippet || null}, ${notes || null})
  `;
  redirect("/admin/seo/aeo");
}
