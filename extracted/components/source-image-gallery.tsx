import type { Source } from "@/lib/posts"

export type InlineImage = { src: string; caption: string }

export type SourceWithImage = Source & {
  imageUrl: string | null
  inlineImages: InlineImage[]
}

export default function SourceImageGallery({ sources }: { sources: SourceWithImage[] }) {
  // Prefer sources with images, pad with no-image sources up to 3 cards
  const withImg = sources.filter((s) => s.imageUrl).slice(0, 3)
  const withoutImg = withImg.length < 3
    ? sources.filter((s) => !s.imageUrl).slice(0, 3 - withImg.length)
    : []
  const all = [...withImg, ...withoutImg]

  if (all.length === 0) return null

  return (
    <section className="source-gallery-section">
      <h2 className="source-gallery-heading">As Reported By</h2>
      <p className="source-gallery-subheading">
        Coverage from news agencies and institutions cited in this article
      </p>
      <div className="source-gallery-grid">
        {all.map((src) => (
          <a
            key={src.url}
            href={src.url}
            target="_blank"
            rel="noopener noreferrer"
            className="source-gallery-card"
          >
            {src.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={src.imageUrl}
                alt={src.title}
                className="source-gallery-img"
                loading="lazy"
              />
            ) : (
              <div className="source-gallery-img-placeholder">📰</div>
            )}
            <div className="source-gallery-body">
              <span className="source-gallery-publisher">Source: {src.publisher}</span>
              <h3 className="source-gallery-title">{src.title}</h3>
              {src.snippet && (
                <p className="source-gallery-snippet">{src.snippet}</p>
              )}
              <span className="source-gallery-cta">Read full article →</span>
            </div>
          </a>
        ))}
      </div>
    </section>
  )
}
