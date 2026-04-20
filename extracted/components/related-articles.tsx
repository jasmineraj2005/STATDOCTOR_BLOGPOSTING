import Link from "next/link"
import { PILLAR_LABELS, type Post } from "@/lib/posts"

export default function RelatedArticles({ posts }: { posts: Post[] }) {
  if (posts.length === 0) return null

  const shown = posts.slice(0, 3)

  return (
    <section className="related-articles-section">
      <h2 className="related-articles-heading">Related Articles</h2>
      <div className="related-articles-grid">
        {shown.map((post) => (
          <Link key={post.slug} href={`/dashboard/posts/${post.slug}`} className="related-article-card">
            <div className="related-article-img-placeholder">🩺</div>
            <div className="related-article-body">
              <span className="related-article-pillar">
                {PILLAR_LABELS[post.pillar] ?? post.pillar}
              </span>
              <h3 className="related-article-title">{post.title}</h3>
              <span className="related-article-cta">
                Read article →
              </span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  )
}
