import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Sign-in handler. Accepts { email, password }, checks against the configured
 * credential pair, sets an HttpOnly `admin_token` cookie whose value is the
 * server's ADMIN_TOKEN env var. Subsequent requests to /admin/* pass auth
 * because lib/admin/auth.ts compares this cookie to the same env var.
 *
 * Env:
 *   - ADMIN_USERNAME (default: "anu@statdoctor.au")
 *   - ADMIN_PASSWORD (default: "statdoctor@1")
 *   - ADMIN_TOKEN    (required — what gets stored in the cookie)
 */
export async function POST(req: Request) {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken) {
    return NextResponse.json(
      { error: "server_misconfigured", detail: "ADMIN_TOKEN not set" },
      { status: 500 },
    );
  }

  let body: { email?: string; password?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const validEmail = process.env.ADMIN_USERNAME ?? "anu@statdoctor.au";
  const validPassword = process.env.ADMIN_PASSWORD ?? "statdoctor@1";

  if (body.email !== validEmail || body.password !== validPassword) {
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  const jar = await cookies();
  jar.set("admin_token", adminToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });

  return NextResponse.json({ ok: true, redirect: "/admin/posts" });
}
