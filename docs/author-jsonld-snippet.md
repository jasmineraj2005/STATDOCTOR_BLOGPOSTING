# Author JSON-LD snippet for `statdoctor-frontend/about`

A copy-paste artefact for the **website repo** (not this admin repo). Drop this `<script>` into the `<head>` (or anywhere in the body — Google reads either) of `statdoctor-frontend.vercel.app/about` to give the author page rich `Person` semantics. This is what makes Google trust "Dr Anu" as a real medical author (E-E-A-T signal for YMYL content).

Why this matters: medical / health content on the open web is held to a higher bar by Google. A `Person` entity with a verifiable `sameAs` link to the AHPRA register is the single biggest trust signal you can ship for the byline.

---

## What to add

In the website repo, edit `app/about/page.tsx` (or wherever the author page renders) and add this inside the JSX, ideally near the top of the rendered tree so it lives in the page's static markup:

```tsx
<script
  type="application/ld+json"
  dangerouslySetInnerHTML={{
    __html: JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Person",
      "@id": "https://statdoctor.app/about#anu",
      "name": "Dr Anu Ganugapati",
      "givenName": "Anu",
      "familyName": "Ganugapati",
      "jobTitle": "Founder & CEO, StatDoctor",
      "url": "https://statdoctor.app/about",
      "image": "https://statdoctor-frontend.vercel.app/author-anu-speaking.png",
      "email": "mailto:anu@statdoctor.net",
      "homeLocation": {
        "@type": "Place",
        "name": "Brisbane, Australia"
      },
      "worksFor": {
        "@type": "Organization",
        "name": "StatDoctor",
        "url": "https://statdoctor.app/"
      },
      "knowsAbout": [
        "Locum medicine",
        "Emergency medicine",
        "Medical workforce in Australia",
        "AHPRA registration"
      ],
      "sameAs": [
        "https://www.linkedin.com/in/dr-anu-g-%F0%9F%A9%BA-3b330a248/",
        // Paste your individual AHPRA register URL here once you know it.
        // Get it from https://www.ahpra.gov.au/registration/registers-of-practitioners.aspx
        // — search your full name, open the register entry, copy that URL.
        // Without this link the medical-author E-E-A-T signal is weaker but the
        // snippet still works.
      ],
      "memberOf": [
        // Add affiliations if relevant — RACGP, AMA, etc.
      ],
      "alumniOf": [
        // Optional — medical school / residency. Add if you want.
      ]
    }),
  }}
/>
```

---

## What to also do on the website

1. **Set the page's `<title>` and meta description:**
   ```tsx
   export const metadata: Metadata = {
     title: "About Dr Anu Ganugapati — Founder & CEO of StatDoctor",
     description: "Emergency physician, founder of StatDoctor — Australia's zero-commission locum doctor marketplace. AHPRA-registered. Brisbane-based.",
     alternates: { canonical: "https://statdoctor.app/about" },
   };
   ```

2. **Wire the blog byline** in the blog post template so each article's "By Dr Anu Ganugapati" links to `/about`:
   ```tsx
   <a href="/about#anu" rel="author">Dr Anu Ganugapati</a>
   ```

3. **Each blog post's `MedicalScholarlyArticle` JSON-LD should reference this Person by @id** so Google connects them:
   ```json
   "author": { "@id": "https://statdoctor.app/about#anu" }
   ```
   (Instead of inlining the full Person object on every article. One canonical Person, referenced everywhere.)

---

## Validation

After deploying:

1. Open `https://statdoctor.app/about` (or wherever it lives)
2. View source → confirm the `<script type="application/ld+json">` block is present
3. Run it through both:
   - <https://validator.schema.org/> — paste the URL
   - <https://search.google.com/test/rich-results> — paste the URL
4. Both should report "Person" detected, zero errors.

---

## Don't do these

- **Don't inline the full Person block on every article.** Define it once on `/about`, reference by `@id` from articles.
- **Don't link `sameAs` to a public-profile aggregator** (Crunchbase, etc.) without verification — Google will downgrade trust if the link looks aggregator-y.
- **Don't add fake credentials.** AHPRA register lookup is the verification source of truth.
- **Don't expose your personal mobile number.** Email-only is fine.
