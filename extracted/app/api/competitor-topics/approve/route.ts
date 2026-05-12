import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isAuthorised(): boolean {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken) return true;
  const provided = cookies().get("admin_token")?.value;
  return provided === adminToken;
}

export async function POST(req: Request) {
  if (!isAuthorised()) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const form = await req.formData();
  const id = String(form.get("id") ?? "");
  const action = String(form.get("action") ?? "");
  if (!id || !["approve", "reject"].includes(action)) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  try {
    if (action === "approve") {
      const current = (await kv.get<string[]>("competitor:approved-ids")) ?? [];
      if (!current.includes(id)) {
        await kv.set("competitor:approved-ids", [...current, id]);
      }
      // Add to existing-ids so future audits don't re-propose.
      const existing = (await kv.get<string[]>("competitor:existing-ids")) ?? [];
      if (!existing.includes(id)) {
        await kv.set("competitor:existing-ids", [...existing, id]);
      }
    } else {
      // Rejection: track separately so the admin UI doesn't re-show it,
      // but don't pollute existing-ids (a future audit might re-cluster
      // the same titles into a better proposal).
      const rejected = (await kv.get<string[]>("competitor:rejected-ids")) ?? [];
      if (!rejected.includes(id)) {
        await kv.set("competitor:rejected-ids", [...rejected, id]);
      }
    }
  } catch (e) {
    return NextResponse.json({ error: "kv unavailable", detail: String(e) }, { status: 500 });
  }

  // Redirect back to the admin UI. PRG pattern keeps the back button sane.
  return NextResponse.redirect(new URL("/admin/competitor-topics", req.url), 303);
}
