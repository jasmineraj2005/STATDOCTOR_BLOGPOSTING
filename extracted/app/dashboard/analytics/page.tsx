import ShaderBackground from "@/components/shader-background"
import Header from "@/components/header"
import AnalyticsDashboard from "@/components/analytics-dashboard"
import { getAllPosts, computeStats } from "@/lib/posts-server"

export const dynamic = "force-dynamic"

export default function AnalyticsPage() {
  const posts = getAllPosts()
  const stats = computeStats(posts)

  return (
    <ShaderBackground>
      <Header />
      <AnalyticsDashboard posts={posts} stats={stats} />
    </ShaderBackground>
  )
}
