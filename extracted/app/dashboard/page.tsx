import { redirect } from "next/navigation";

// Legacy v0 dashboard — superseded by /admin/posts (DB-backed review queue).
// Keeps any bookmarks / external links from dead-ending.
export default function DashboardLegacyRedirect() {
  redirect("/admin/posts");
}
