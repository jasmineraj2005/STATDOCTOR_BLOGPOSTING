/**
 * Unit tests for source-image-gallery credit logic.
 *
 * Tests the rendering rules for image credits without needing full JSX rendering.
 * We validate the two helper functions (buildCreditLine, resolveImageUrl) inline
 * here since they are internal to the component.
 */

import { describe, it, expect } from "vitest"
import type { Source } from "@/lib/posts"
import type { SourceWithImage } from "./source-image-gallery"

// ── Inline copies of the helpers (mirrors component logic exactly) ────────────
// These must stay in sync with source-image-gallery.tsx.

function resolveImageUrl(src: SourceWithImage): string | null {
  if (src.imageUrl) return src.imageUrl
  if (src.image_url) return src.image_url
  return null
}

function buildCreditLine(src: SourceWithImage): string | null {
  const publisher = src.image_credit_publisher ?? null
  const author = src.image_credit_author ?? null
  if (!publisher) return null
  return author ? `Photo: ${publisher} / ${author}` : `Photo: ${publisher}`
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSource(overrides: Partial<Source & SourceWithImage> = {}): SourceWithImage {
  return {
    title: "Test Article",
    url: "https://theguardian.com/test",
    publisher: "The Guardian",
    snippet: "Some snippet",
    imageUrl: null,
    inlineImages: [],
    ...overrides,
  }
}

// ── resolveImageUrl ───────────────────────────────────────────────────────────

describe("resolveImageUrl", () => {
  it("returns null when no image on source", () => {
    const src = makeSource()
    expect(resolveImageUrl(src)).toBeNull()
  })

  it("returns camelCase imageUrl when set (legacy adapter path)", () => {
    const src = makeSource({ imageUrl: "https://example.com/img.jpg" })
    expect(resolveImageUrl(src)).toBe("https://example.com/img.jpg")
  })

  it("returns snake_case image_url when imageUrl is null (pipeline path)", () => {
    const src = makeSource({ image_url: "https://i.guim.co.uk/media/abc.jpg" })
    expect(resolveImageUrl(src)).toBe("https://i.guim.co.uk/media/abc.jpg")
  })

  it("prefers imageUrl over image_url when both are set", () => {
    const src = makeSource({
      imageUrl: "https://legacy.example.com/img.jpg",
      image_url: "https://pipeline.example.com/img.jpg",
    })
    expect(resolveImageUrl(src)).toBe("https://legacy.example.com/img.jpg")
  })
})

// ── buildCreditLine ───────────────────────────────────────────────────────────

describe("buildCreditLine", () => {
  it("returns null when no credit publisher set", () => {
    const src = makeSource({ image_url: "https://example.com/img.jpg" })
    expect(buildCreditLine(src)).toBeNull()
  })

  it('returns "Photo: {publisher}" when only publisher set', () => {
    const src = makeSource({
      image_url: "https://www.abc.net.au/img.jpg",
      image_credit_publisher: "ABC News",
    })
    expect(buildCreditLine(src)).toBe("Photo: ABC News")
  })

  it('returns "Photo: {publisher} / {author}" when both publisher and author set', () => {
    const src = makeSource({
      image_url: "https://i.guim.co.uk/img/media/abc.jpg",
      image_credit_publisher: "The Guardian",
      image_credit_author: "Mike Bowers/AAP",
    })
    expect(buildCreditLine(src)).toBe("Photo: The Guardian / Mike Bowers/AAP")
  })

  it("returns publisher-only line when author is null", () => {
    const src = makeSource({
      image_url: "https://www.racgp.org.au/img.jpg",
      image_credit_publisher: "RACGP",
      image_credit_author: null,
    })
    expect(buildCreditLine(src)).toBe("Photo: RACGP")
  })

  it("returns null when publisher is null even if author is set", () => {
    const src = makeSource({
      image_url: "https://example.com/img.jpg",
      image_credit_publisher: null,
      image_credit_author: "Jane Doe",
    })
    expect(buildCreditLine(src)).toBeNull()
  })
})

// ── Gallery filtering logic ───────────────────────────────────────────────────

describe("SourceImageGallery filtering logic", () => {
  it("identifies sources with images correctly", () => {
    const sources: SourceWithImage[] = [
      makeSource({ url: "https://a.com", image_url: "https://a.com/img.jpg", image_credit_publisher: "Pub A" }),
      makeSource({ url: "https://b.com" }),  // no image
      makeSource({ url: "https://c.com", imageUrl: "https://c.com/img.jpg" }),  // legacy imageUrl
    ]

    const withImg = sources.filter((s) => resolveImageUrl(s) !== null)
    expect(withImg).toHaveLength(2)
    expect(withImg.map((s) => s.url)).toContain("https://a.com")
    expect(withImg.map((s) => s.url)).toContain("https://c.com")
  })

  it("renders credit text for each source with image_url from pipeline", () => {
    const sources: SourceWithImage[] = [
      makeSource({
        url: "https://theguardian.com/article",
        image_url: "https://i.guim.co.uk/img.jpg",
        image_credit_publisher: "The Guardian",
        image_credit_author: "Nick Evershed",
      }),
      makeSource({
        url: "https://www.abc.net.au/article",
        image_url: "https://www.abc.net.au/photo.jpg",
        image_credit_publisher: "ABC News",
      }),
    ]

    const credits = sources
      .filter((s) => resolveImageUrl(s) !== null)
      .map((s) => buildCreditLine(s))

    expect(credits).toContain("Photo: The Guardian / Nick Evershed")
    expect(credits).toContain("Photo: ABC News")
  })
})
