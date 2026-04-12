import { NextResponse } from "next/server"
import { computeStats, getAllPosts } from "@/lib/posts-server"

export const dynamic = "force-dynamic"

export async function GET() {
  const posts = getAllPosts()
  const stats = computeStats(posts)
  return NextResponse.json({ posts, stats })
}
