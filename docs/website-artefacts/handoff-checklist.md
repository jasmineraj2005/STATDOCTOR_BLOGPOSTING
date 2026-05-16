# M6 Handoff Checklist — Schema artefacts for `~/website/`

Do this in a **new session** opened inside the `~/website/` repository.
Each step is ~2–5 minutes. Total time: 30–45 minutes including validation.

---

## Before you start

- [ ] You are in `~/website/` — NOT in `STATDOCTOR_BLOGPOSTING/`
- [ ] The website is live at `https://statdoctor.app/` and deploys are working
- [ ] You have the artefacts from `STATDOCTOR_BLOGPOSTING/docs/website-artefacts/`

---

## Step 1 — Drop in the component files

Copy these three files from `STATDOCTOR_BLOGPOSTING/docs/website-artefacts/` into `~/website/`:

| Source artefact | Destination in `~/website/` |
|---|---|
| `organization-schema.tsx` | `components/OrganizationSchema.tsx` |
| `medical-scholarly-article.tsx` | `components/MedicalScholarlyArticleSchema.tsx` |
| `author-page.tsx` | `app/about/dr-anu-ganugapati/page.tsx` |

If `~/website/` uses a `src/` layout (e.g. `src/components/`, `src/app/`), adjust paths accordingly.

Create the directory if it doesn't exist:
```bash
mkdir -p ~/website/app/about/dr-anu-ganugapati
```

---

## Step 2 — Drop in the sitemap and robots

| Source artefact | Destination in `~/website/` |
|---|---|
| `sitemap.ts` | `app/sitemap.ts` |
| `robots.ts` | `app/robots.ts` |

If `~/website/app/sitemap.ts` or `robots.ts` already exist, **read them first** before overwriting — you may need to merge rather than replace.

---

## Step 3 — Update the root layout

Open `~/website/app/layout.tsx` and apply the changes in `layout-changes.md`.

Summary of changes:
1. `<html lang="en-AU">` (was `lang="en"` or missing)
2. Add `other: { "geo.region": "AU", ... }` to the `metadata` export
3. Remove `keywords` from the `metadata` export if present
4. Import `OrganizationSchema` and render it in the layout body

Full before/after example is in `layout-changes.md`.

---

## Step 4 — Wire `MedicalScholarlyArticleSchema` into blog post pages

Open `~/website/app/blog/[slug]/page.tsx` (or equivalent). At the top of the rendered JSX, add the schema component:

```tsx
import { MedicalScholarlyArticleSchema } from "@/components/MedicalScholarlyArticleSchema";

export default async function BlogPostPage({ params }) {
  const post = await getPost(params.slug); // your existing data-fetch

  return (
    <>
      <MedicalScholarlyArticleSchema post={post} />
      {/* ... rest of your page ... */}
    </>
  );
}
```

The `post` object passed to the component must have these fields (see the component file for the full type):
- `title` — article headline
- `slug` — URL slug
- `meta_description` — used as schema `description`
- `image_url` — hero image URL (optional but recommended)
- `og_image_alt` — image alt text
- `datePublished` — ISO 8601 date string
- `dateModified` — ISO 8601 date string
- `target_keywords` — array of keyword strings
- `sources` — array of `{ title, url, publisher }` objects
- `content_type` — `"news"` | `"guide"` | `"company"`

These fields are all present in the objects returned by `/api/public/posts` on the admin dashboard. Check your website's data-fetching layer to confirm field names match; rename as needed.

---

## Step 5 — Fill in the placeholders

Several fields in the artefacts are marked `PLACEHOLDER`. Fill these in before deploying:

### In `organization-schema.tsx` (now at `components/OrganizationSchema.tsx`)

| Placeholder | What to fill in |
|---|---|
| Logo URL | Upload `logo.png` to `~/website/public/images/logo.png`, then set URL to `https://statdoctor.app/images/logo.png` |
| `sameAs` LinkedIn company page | Create a LinkedIn company page for StatDoctor if it doesn't exist; paste the URL |
| `sameAs` ABN Lookup URL | Find StatDoctor's ABN, format: `https://abr.business.gov.au/ABN/View?abn=<ABN>` |
| `address.postalCode` | Replace `4000` with the actual registered postcode |
| `address.streetAddress` | Add the registered street address if known |

### In `author-page.tsx` (now at `app/about/dr-anu-ganugapati/page.tsx`)

| Placeholder | What to fill in |
|---|---|
| Author photo | Upload photo to `~/website/public/images/dr-anu-ganugapati.jpg`. Replace the `<div>` placeholder with `<Image>` from `next/image` |
| AHPRA register URL | 1. Go to https://www.ahpra.gov.au/registration/registers-of-practitioners.aspx 2. Search "Anu Ganugapati" 3. Open the result 4. Copy the URL from the browser 5. Add it to the `sameAs` array in the schema AND update the `<a>` link in the visible content |

### In `~/website/.env.local` (or Vercel env vars)

Add:
```
NEXT_PUBLIC_SITE_URL=https://statdoctor.app
```

---

## Step 6 — Build locally and check for TypeScript errors

```bash
cd ~/website
pnpm build
# or: npm run build
```

Fix any TypeScript errors before deploying. Common issues:
- `Post` type fields not matching — rename fields in the component or adapt the `Post` interface in `MedicalScholarlyArticleSchema.tsx`
- Missing `JSX.Element` return type — add `React` import or configure `jsx` in tsconfig

---

## Step 7 — Deploy to Vercel

```bash
git add .
git commit -m "feat: M6 schema artefacts — Organization, Person, MedicalScholarlyArticle, sitemap, robots, en-AU lang"
git push
```

Vercel will auto-deploy from the push. Watch the build logs for errors.

---

## Step 8 — Validate with Google Rich Results Test

After deploy (allow ~2 minutes for Vercel to propagate):

### Test 1 — Author page (Person schema)
1. Open https://search.google.com/test/rich-results
2. Enter `https://statdoctor.app/about/dr-anu-ganugapati`
3. Click "Test URL"
4. Expected: **"Person" detected**, zero errors, zero warnings (some warnings are acceptable)

### Test 2 — Blog post page (MedicalScholarlyArticle schema)
1. Open https://search.google.com/test/rich-results
2. Enter any published blog post URL, e.g. `https://statdoctor.app/blog/how-will-medicare-reforms-impact-locum-doctors-in-australia`
3. Expected: **Article or MedicalScholarlyArticle detected**, author referenced

### Test 3 — Homepage (Organization schema)
1. Open https://search.google.com/test/rich-results
2. Enter `https://statdoctor.app/`
3. Expected: **Organization detected**, zero errors

### Backup validator (catches more issues)
Run the same three URLs through https://validator.schema.org/ — this catches JSON-LD syntax errors that the Rich Results Test sometimes misses.

---

## Step 9 — Verify sitemap and robots

```bash
# Sitemap — should return XML with static + dynamic routes
curl https://statdoctor.app/sitemap.xml

# Robots — should show Allow: / and Disallow: /api/
curl https://statdoctor.app/robots.txt
```

Expected `robots.txt` output:
```
User-agent: *
Allow: /
Disallow: /api/

Sitemap: https://statdoctor.app/sitemap.xml
```

---

## Expected outcome

When all steps are complete:
- [ ] Rich Results Test passes for **Person** on the author page
- [ ] Rich Results Test passes for **Article/MedicalScholarlyArticle** on any blog post
- [ ] Rich Results Test passes for **Organization** on the homepage
- [ ] `/sitemap.xml` returns all static routes + all published blog posts
- [ ] `/robots.txt` allows all crawlers and references the sitemap
- [ ] `<html lang="en-AU">` visible in page source
- [ ] Geo meta tags visible in page source on every page
- [ ] No `<meta name="keywords">` in page source

---

## If something breaks

- **TypeScript build error in the schema component:** the `Post` type shape in `MedicalScholarlyArticleSchema.tsx` may not match your website's actual type. Edit the inline `Post` interface at the top of that file to match your repo's fields.
- **Rich Results Test shows "no rich results":** check that the `<script type="application/ld+json">` block is present in page source (Cmd+U / Ctrl+U → search for "ld+json"). If not present, the component isn't being rendered — check the import and placement.
- **Sitemap is empty (only static routes):** the `/api/public/posts` API on the admin dashboard may be returning an error. Check `https://statdoctor-blogposting.vercel.app/api/public/posts` directly — does it return a valid JSON response with a `posts` array?
- **AHPRA register URL not found:** the register search may not return results if the name is not an exact match. Try searching surname only ("Ganugapati"). If still not found, the registration may be under a slightly different name variant — check the AHPRA registration documents.
