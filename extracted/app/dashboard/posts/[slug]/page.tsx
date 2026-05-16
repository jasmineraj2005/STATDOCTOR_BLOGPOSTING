import { redirect } from "next/navigation";

// Legacy v0 post detail — superseded by /admin/posts/[slug] (DB-backed edit
// + validators + Approve flow). The filesystem-based reader broke on Vercel
// since backend/output/ isn't deployed; redirect preserves any bookmarks.
export default async function DashboardPostLegacyRedirect({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  redirect(`/admin/posts/${slug}`);
}
