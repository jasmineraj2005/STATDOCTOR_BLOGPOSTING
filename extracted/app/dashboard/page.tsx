import ShaderBackground from "@/components/shader-background"
import Header from "@/components/header"
import DashboardCards from "@/components/dashboard-cards"
import { computeStats, getAllPosts } from "@/lib/posts-server"

// Rebuild on every request — posts are generated server-side by the Python pipeline
export const dynamic = "force-dynamic"

export default function DashboardPage() {
  const posts = getAllPosts()
  const stats = computeStats(posts)

  return (
    <ShaderBackground>
      <Header />
      <DashboardCards posts={posts} stats={stats} />
    </ShaderBackground>
  )
}
