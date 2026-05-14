import { redirect } from "next/navigation";

// Legacy v0 analytics — superseded by /admin/seo (Postgres-backed SEO dashboard).
export default function DashboardAnalyticsLegacyRedirect() {
  redirect("/admin/seo");
}
