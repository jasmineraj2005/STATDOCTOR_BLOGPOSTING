import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  const jar = await cookies();
  jar.delete("admin_token");
  return NextResponse.json({ ok: true, redirect: "/login" });
}
