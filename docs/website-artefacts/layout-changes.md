# Layout changes for `~/website/app/layout.tsx`

These are diff-style instructions for updating the root layout of the `~/website/` Next.js app. Make each change in the order listed. All changes are additive or corrective — nothing here removes existing functionality.

---

## 1. Set `lang="en-AU"` on the `<html>` element

This is the single highest-impact change for Australian SEO. Google and Bing use this attribute to disambiguate region-specific content. Without it, Australian spelling and terminology can be scored as "non-standard English," which depresses rankings for AU-targeted queries.

### Before

```tsx
<html>
```

### After

```tsx
<html lang="en-AU">
```

---

## 2. Add geo meta tags inside `<head>`

These are consumed by Bing (and legacy Google signals) for geographic targeting. Place them inside the `<head>` section of the layout, or inside the `metadata` export if using Next.js App Router metadata API.

### Option A — Direct JSX in `<head>` (if you have a `<head>` block)

```tsx
<head>
  {/* existing head content ... */}

  {/* Australian geo signals — add these */}
  <meta name="geo.region" content="AU" />
  <meta name="geo.country" content="AU" />
  <meta name="geo.placename" content="Australia" />
</head>
```

### Option B — Next.js App Router `metadata` export (preferred for App Router)

In `~/website/app/layout.tsx`, add or extend the `metadata` export:

```tsx
import type { Metadata } from "next";

export const metadata: Metadata = {
  // ... your existing metadata fields ...
  other: {
    "geo.region": "AU",
    "geo.country": "AU",
    "geo.placename": "Australia",
  },
};
```

Next.js will render these as `<meta>` tags automatically when you use the `other` field.

---

## 3. Remove `<meta name="keywords">` if present

Google has ignored this tag since 2009. Bing's guidelines flag keyword-stuffed `<meta name="keywords">` as a spam signal. If it exists in the layout, remove it.

### Before (remove this if present)

```tsx
<meta name="keywords" content="locum doctor, locum work, Australia, AHPRA, ..." />
```

### After

*(delete the line entirely — no replacement needed)*

If keywords are set via Next.js `metadata.keywords`, remove that field:

```tsx
// REMOVE this from the metadata export:
keywords: ["locum doctor", "locum work", "Australia", ...],
```

---

## 4. Import and render the `OrganizationSchema` component

The `OrganizationSchema` component (from `organization-schema.tsx`) must be rendered in the root layout so every page carries the Organization entity. This is the entity-disambiguation signal that tells Google "StatDoctor is a real, verifiable medical business in Australia."

### Step 1 — Copy the component file

Copy `docs/website-artefacts/organization-schema.tsx` from this repo to:

```
~/website/components/OrganizationSchema.tsx
```

(or `~/website/src/components/OrganizationSchema.tsx` if the project uses a `src/` layout — match your project structure)

### Step 2 — Import it in the layout

### Before

```tsx
import type { Metadata } from "next";
// ... other imports ...

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

### After

```tsx
import type { Metadata } from "next";
// ... other imports ...
import { OrganizationSchema } from "@/components/OrganizationSchema";
// adjust the import path if your alias is different (e.g. "~/components/...")

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en-AU">
      <body>
        {/* Organization schema — entity disambiguation for every page */}
        <OrganizationSchema />
        {children}
      </body>
    </html>
  );
}
```

---

## 5. Full before/after for a typical layout (reference)

Here is a consolidated before/after showing all changes together:

### Before (typical minimal layout)

```tsx
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: {
    template: "%s | StatDoctor",
    default: "StatDoctor — Zero-Commission Locum Marketplace",
  },
  description: "Find locum doctor shifts across Australia without agency fees.",
  keywords: ["locum doctor", "locum work Australia", "AHPRA"],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

### After (with all M6 changes applied)

```tsx
import type { Metadata } from "next";
import { OrganizationSchema } from "@/components/OrganizationSchema";

export const metadata: Metadata = {
  title: {
    template: "%s | StatDoctor",
    default: "StatDoctor — Zero-Commission Locum Marketplace",
  },
  description: "Find locum doctor shifts across Australia without agency fees.",
  // REMOVED: keywords (Google ignores; Bing flags as spam signal)
  other: {
    "geo.region": "AU",
    "geo.country": "AU",
    "geo.placename": "Australia",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en-AU">
      <body>
        <OrganizationSchema />
        {children}
      </body>
    </html>
  );
}
```

---

## Checklist after applying changes

- [ ] `<html lang="en-AU">` visible in page source
- [ ] `<meta name="geo.region" content="AU">` visible in page source
- [ ] No `<meta name="keywords">` in page source
- [ ] `<script type="application/ld+json">` with `"@type": "MedicalBusiness"` visible in page source on every page
- [ ] Run https://validator.schema.org/ against the homepage — zero errors expected
- [ ] Run https://search.google.com/test/rich-results — Organization detected
