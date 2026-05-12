import { cookies } from "next/headers";

/** Server-side admin gate. In local dev without ADMIN_TOKEN, every request passes. */
export async function isAuthorised(): Promise<boolean> {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken) return true;
  const provided = (await cookies()).get("admin_token")?.value;
  return provided === adminToken;
}
