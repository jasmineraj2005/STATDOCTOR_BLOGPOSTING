import type { Source } from "@/lib/posts"

export type InlineImage = { src: string; caption: string }

export type SourceWithImage = Source & {
  imageUrl: string | null
  inlineImages: InlineImage[]
}

/**
 * Resolve the best image URL for a source card.
 *
 * Priority: legacy `imageUrl` (camelCase, set by the preview pane adapter) →
 * new `image_url` (snake_case, from the JSON pipeline).
 */
function resolveImageUrl(src: SourceWithImage): string | null {
  if (src.imageUrl) return src.imageUrl
  if (src.image_url) return src.image_url
  return null
}

/**
 * Build a credit string like "Photo: The Guardian / Mike Bowers AAP"
 * or "Photo: ABC News" from the source's credit fields.
 */
function buildCreditLine(src: SourceWithImage): string | null {
  const publisher = src.image_credit_publisher ?? null
  const author = src.image_credit_author ?? null
  if (!publisher) return null
  return author ? `Photo: ${publisher} / ${author}` : `Photo: ${publisher}`
}

export default function SourceImageGallery({ sources }: { sources: SourceWithImage[] }) {
  // Prefer sources with images, pad with no-image sources up to 3 cards
  const withImg = sources.filter((s) => resolveImageUrl(s) !== null).slice(0, 3)
  const withoutImg = withImg.length < 3
    ? sources.filter((s) => resolveImageUrl(s) === null).slice(0, 3 - withImg.length)
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
        {all.map((src) => {
          const imgUrl = resolveImageUrl(src)
          const creditLine = buildCreditLine(src)
          const altText = src.image_alt ?? src.title
          return (
            <a
              key={src.url}
              href={src.url}
              target="_blank"
              rel="noopener noreferrer"
              className="source-gallery-card"
            >
              {imgUrl ? (
                <figure className="source-gallery-figure">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={imgUrl}
                    alt={altText}
                    className="source-gallery-img"
                    loading="lazy"
                  />
                  {creditLine && (
                    <figcaption className="source-gallery-credit">
                      {creditLine}
                    </figcaption>
                  )}
                </figure>
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
          )
        })}
      </div>
    </section>
  )
}
