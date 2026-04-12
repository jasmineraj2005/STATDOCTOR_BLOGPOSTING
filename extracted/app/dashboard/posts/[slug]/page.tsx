import { notFound } from "next/navigation"
import ShaderBackground from "@/components/shader-background"
import Header from "@/components/header"
import PostDetail from "@/components/post-detail"
import { getPostBySlug } from "@/lib/posts-server"

export const dynamic = "force-dynamic"

export default async function PostDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const post = getPostBySlug(slug)
  if (!post) notFound()

  return (
    <ShaderBackground>
      <Header />
      <PostDetail post={post} />
    </ShaderBackground>
  )
}
