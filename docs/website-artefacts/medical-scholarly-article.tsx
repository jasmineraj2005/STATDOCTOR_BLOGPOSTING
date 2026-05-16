/**
 * Drop-in reusable schema component for ~/website/ blog post pages.
 *
 * Usage: import and render inside each blog post page component, e.g.:
 *
 *   // ~/website/app/blog/[slug]/page.tsx
 *   import { MedicalScholarlyArticleSchema } from "@/components/MedicalScholarlyArticleSchema";
 *
 *   export default function BlogPostPage({ params }) {
 *     const post = await getPost(params.slug); // your data-fetching function
 *     return (
 *       <>
 *         <MedicalScholarlyArticleSchema post={post} />
 *         {... rest of page ...}
 *       </>
 *     );
 *   }
 *
 * -------------------------------------------------------------------------
 * Expected Post type shape (adapt to your website repo's actual type):
 * -------------------------------------------------------------------------
 *
 * interface Source {
 *   title: string;
 *   url: string;
 *   publisher: string;
 *   snippet?: string;
 * }
 *
 * type ContentType = "news" | "guide" | "company";
 *
 * interface Post {
 *   title: string;
 *   slug: string;
 *   meta_description: string;
 *   image_url?: string | null;
 *   og_image_alt?: string;
 *   datePublished: string;      // ISO 8601, e.g. "2026-04-11"
 *   dateModified: string;       // ISO 8601
 *   target_keywords: string[];  // used as schema `keywords`
 *   sources: Source[];          // becomes schema `citation` array
 *   content_type: ContentType;  // drives `publicationType` MeSH mapping
 * }
 *
 * The website repo will import the Post type from its own types — adapt as needed.
 * -------------------------------------------------------------------------
 *
 * Judgment calls:
 *
 * @type "MedicalScholarlyArticle":
 *   Chosen over "Article" because YMYL medical content gets higher E-E-A-T
 *   weighting with the more specific type. schema.org defines it as a subtype
 *   of ScholarlyArticle appropriate for health/medical topics.
 *
 * reviewedBy = author (Anu):
 *   For YMYL content, Google's Quality Rater Guidelines weigh medical review
 *   separately from authorship. Since Anu is both author and clinical reviewer,
 *   pointing reviewedBy at the same @id is technically accurate and adds the
 *   signal without any fabrication. If a second reviewer is added later, swap
 *   this out for their Person @id.
 *
 * publicationType MeSH mapping:
 *   MeSH (Medical Subject Headings) vocabulary. "Review" is correct for guide
 *   content; "News Article" is per the schema.org MeSH mapping. "company" pillar
 *   omits publicationType since it's promotional, not a publication type.
 *   See: https://schema.org/publicationType
 *
 * citation array:
 *   Each source is typed as ScholarlyArticle — this is intentionally broad.
 *   If a source is a news article or gov page rather than a true scholarly article,
 *   schema.org will still accept it; the validator won't fail. If you want stricter
 *   typing, map `publisher` to "@type": "NewsArticle" for press sources.
 */

// the website repo will import Post from its own types — adapt:
// import type { Post } from "@/types/post";

// Inline the minimal shape needed for this component so it compiles in isolation:
interface Source {
  title: string;
  url: string;
  publisher: string;
  snippet?: string;
}

type ContentType = "news" | "guide" | "company";

interface Post {
  title: string;
  slug: string;
  meta_description: string;
  image_url?: string | null;
  og_image_alt?: string;
  datePublished: string;
  dateModified: string;
  target_keywords: string[];
  sources: Source[];
  content_type: ContentType;
}

// ---------------------------------------------------------------------------
// MeSH publicationType mapping
// ---------------------------------------------------------------------------

function getPublicationType(contentType: ContentType): string | undefined {
  switch (contentType) {
    case "guide":
      return "Review";
    case "news":
      return "News Article";
    case "company":
      // Promotional/company-pov content: omit publicationType entirely.
      // Assigning a MeSH type here would be misleading.
      return undefined;
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Schema builder
// ---------------------------------------------------------------------------

function buildSchema(post: Post): Record<string, unknown> {
  const publicationType = getPublicationType(post.content_type);

  // Citation array — each source becomes a ScholarlyArticle reference.
  // We include `url` and `name` only; do NOT include `description` (snippet)
  // since snippets from the research pipeline may be AI-generated paraphrases,
  // not direct quotes from the cited source.
  const citation = post.sources.map((source) => ({
    "@type": "ScholarlyArticle",
    name: source.title,
    url: source.url,
    // publisher is optional but helps disambiguation
    publisher: {
      "@type": "Organization",
      name: source.publisher,
    },
  }));

  const schema: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "MedicalScholarlyArticle",
    "@id": `https://statdoctor.app/blog/${post.slug}#article`,

    headline: post.title,
    description: post.meta_description,
    url: `https://statdoctor.app/blog/${post.slug}`,

    // Reference author by @id — do NOT inline the full Person object here.
    // The canonical Person is defined once on /about/dr-anu-ganugapati.
    // Google connects them via the shared @id.
    author: {
      "@id": "https://statdoctor.app/about#anu",
    },

    // reviewedBy points to the same Person @id.
    // Rationale: for YMYL content, Google's quality raters look for evidence
    // of medical review separately from authorship. Anu is both.
    reviewedBy: {
      "@id": "https://statdoctor.app/about#anu",
    },

    publisher: {
      "@id": "https://statdoctor.app/#organization",
      // @id must match the @id in organization-schema.tsx
    },

    datePublished: post.datePublished,
    dateModified: post.dateModified,

    keywords: post.target_keywords.join(", "),

    inLanguage: "en-AU",
    isAccessibleForFree: true,

    ...(post.image_url && {
      image: {
        "@type": "ImageObject",
        url: post.image_url,
        description: post.og_image_alt ?? post.title,
      },
    }),

    ...(citation.length > 0 && { citation }),

    ...(publicationType !== undefined && { publicationType }),
  };

  return schema;
}

// ---------------------------------------------------------------------------
// React component
// ---------------------------------------------------------------------------

export function MedicalScholarlyArticleSchema({
  post,
}: {
  post: Post;
}): JSX.Element {
  const schema = buildSchema(post);

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}
