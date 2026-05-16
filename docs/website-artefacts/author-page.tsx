/**
 * Drop-in for ~/website/app/about/dr-anu-ganugapati/page.tsx
 *
 * Place this file at that path in the ~/website/ repo.
 *
 * Type imports: this file imports from "next" only — everything else is inline.
 * The website repo will need `next` installed (it will be, it's a Next.js app).
 */

import type { Metadata } from "next";

// ---------------------------------------------------------------------------
// Page metadata — Next.js App Router
// ---------------------------------------------------------------------------

export const metadata: Metadata = {
  title: "About Dr Anu Ganugapati — Founder & CEO of StatDoctor",
  description:
    "Emergency physician, founder of StatDoctor — Australia's zero-commission locum doctor marketplace. AHPRA-registered. Brisbane-based.",
  alternates: {
    canonical: "https://statdoctor.app/about/dr-anu-ganugapati",
  },
  openGraph: {
    title: "About Dr Anu Ganugapati — Founder & CEO of StatDoctor",
    description:
      "Emergency physician and founder of StatDoctor. AHPRA-registered doctor building a zero-commission locum marketplace for Australian doctors.",
    url: "https://statdoctor.app/about/dr-anu-ganugapati",
    type: "profile",
    images: [
      {
        url: "https://statdoctor.app/images/dr-anu-ganugapati.jpg",
        // PLACEHOLDER: replace with the real production image path once uploaded.
        // Recommended: 1200×630 px, JPEG or PNG. Upload to ~/website/public/images/.
        width: 1200,
        height: 630,
        alt: "Dr Anu Ganugapati — Emergency physician and founder of StatDoctor",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "About Dr Anu Ganugapati — Founder & CEO of StatDoctor",
    description:
      "Emergency physician and founder of StatDoctor. AHPRA-registered doctor building a zero-commission locum marketplace for Australian doctors.",
    images: ["https://statdoctor.app/images/dr-anu-ganugapati.jpg"],
  },
};

// ---------------------------------------------------------------------------
// Person JSON-LD schema
// ---------------------------------------------------------------------------
// Judgment calls documented:
//
// @id: "https://statdoctor.app/about#anu"
//   — canonical IRI for the Person entity. All blog article schemas will
//   reference this @id rather than inlining the full Person object, per
//   Google's recommended entity-disambiguation pattern.
//
// sameAs[1] AHPRA URL: PLACEHOLDER — the AHPRA register URL is per-practitioner.
//   To find yours: https://www.ahpra.gov.au/registration/registers-of-practitioners.aspx
//   Search "Anu Ganugapati", open the result, copy the URL from the browser bar.
//   Format is typically: https://www.ahpra.gov.au/registration/registers-of-practitioners/...
//   Without this link the medical-author E-E-A-T signal is weaker but still valid.
//
// image: points to statdoctor.app — use a permanent, canonical URL for the
//   author photo, NOT a CDN URL that could change. Recommended size: 400×400 px+.
//   Update once you have the real image hosted at the path below.
//
// homeLocation: Brisbane AU — sourced from existing docs/author-jsonld-snippet.md.
//
// medicalSpecialty: "Emergency" is the closest schema.org MedicalSpecialty enum
//   value. The full enum lives at https://schema.org/MedicalSpecialty.

const personSchema = {
  "@context": "https://schema.org",
  "@type": "Person",
  "@id": "https://statdoctor.app/about#anu",
  name: "Dr Anu Ganugapati",
  givenName: "Anu",
  familyName: "Ganugapati",
  jobTitle: "Founder & CEO, StatDoctor",
  url: "https://statdoctor.app/about/dr-anu-ganugapati",
  image: "https://statdoctor.app/images/dr-anu-ganugapati.jpg",
  // PLACEHOLDER: replace the image path above with your actual author photo URL.
  email: "mailto:anu@statdoctor.net",
  homeLocation: {
    "@type": "Place",
    name: "Brisbane, Queensland, Australia",
    address: {
      "@type": "PostalAddress",
      addressLocality: "Brisbane",
      addressRegion: "QLD",
      addressCountry: "AU",
    },
  },
  worksFor: {
    "@type": "Organization",
    "@id": "https://statdoctor.app/#organization",
    // The @id here must match the @id in organization-schema.tsx so Google
    // links the Person and Organization entities together.
    name: "StatDoctor",
    url: "https://statdoctor.app/",
  },
  knowsAbout: [
    "Locum medicine",
    "Emergency medicine",
    "Medical workforce in Australia",
    "AHPRA registration",
    "Healthcare marketplaces",
    "Doctor workforce policy",
  ],
  sameAs: [
    "https://www.linkedin.com/in/dr-anu-g-%F0%9F%A9%BA-3b330a248/",
    // PLACEHOLDER: Paste your AHPRA register URL below once you have it.
    // To retrieve:
    //   1. Visit https://www.ahpra.gov.au/registration/registers-of-practitioners.aspx
    //   2. Search your full name "Anu Ganugapati"
    //   3. Open the result record
    //   4. Copy the full URL from the browser address bar
    //   5. Replace this comment with the URL string (as a plain string, no comment)
    // Example format: "https://www.ahpra.gov.au/registration/registers-of-practitioners/..."
  ],
  // memberOf: [] — add if you are a member of AMA, RACGP, ACEM, or equivalent.
  // alumniOf: [] — add medical school / postgrad if desired.
};

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function DrAnuGanugapatiPage(): JSX.Element {
  return (
    <>
      {/* Structured data — Google reads this from anywhere in the DOM */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(personSchema) }}
      />

      <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
        {/* Hero section */}
        <section className="mb-12 flex flex-col items-start gap-8 sm:flex-row">
          {/* Author photo */}
          {/* PLACEHOLDER: swap <div> for <Image> from "next/image" once image is available */}
          <div
            className="h-40 w-40 flex-shrink-0 overflow-hidden rounded-full bg-slate-200"
            aria-label="Dr Anu Ganugapati"
          >
            {/* Replace this div with:
             * <Image
             *   src="/images/dr-anu-ganugapati.jpg"
             *   alt="Dr Anu Ganugapati — Emergency physician and founder of StatDoctor"
             *   width={160}
             *   height={160}
             *   className="rounded-full object-cover"
             *   priority
             * />
             */}
          </div>

          <div>
            <h1 className="text-3xl font-bold tracking-tight text-gray-900">
              Dr Anu Ganugapati
            </h1>
            <p className="mt-1 text-lg text-gray-600">
              Founder &amp; CEO, StatDoctor &mdash; Emergency Physician
            </p>
            <p className="mt-1 text-sm text-gray-500">Brisbane, QLD, Australia</p>

            {/* AHPRA registration link — most important E-E-A-T signal on this page */}
            <p className="mt-3 text-sm">
              <span className="font-medium text-gray-700">AHPRA registered:</span>{" "}
              {/* PLACEHOLDER: replace href and link text with your actual AHPRA register URL */}
              <a
                href="https://www.ahpra.gov.au/registration/registers-of-practitioners.aspx"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 underline hover:text-blue-800"
              >
                View registration record
              </a>
              {/* Once you have the direct URL, change the href to the direct record URL, e.g.:
               * href="https://www.ahpra.gov.au/registration/registers-of-practitioners/..."
               * and change the link text to your registration number, e.g. "MED0001234567"
               */}
            </p>
          </div>
        </section>

        {/* Bio */}
        <section className="prose prose-gray max-w-none" aria-label="Biography">
          <h2>About</h2>
          <p>
            Dr Anu Ganugapati is an AHPRA-registered emergency physician and the
            founder and CEO of{" "}
            <a href="https://statdoctor.app/" rel="noopener noreferrer">
              StatDoctor
            </a>
            , Australia&apos;s zero-commission locum doctor marketplace. He
            trained and practised in emergency medicine across Queensland before
            starting StatDoctor to solve the recruitment-agency problem he
            experienced firsthand as a locum doctor.
          </p>

          <h2>Credentials</h2>
          <ul>
            <li>AHPRA-registered medical practitioner</li>
            <li>Emergency physician with clinical experience across Queensland</li>
            <li>
              Founder of StatDoctor — connecting locum doctors with healthcare
              facilities across Australia
            </li>
          </ul>

          <h2>Areas of expertise</h2>
          <ul>
            <li>Locum medicine and workforce flexibility in Australia</li>
            <li>Emergency medicine</li>
            <li>AHPRA registration and compliance</li>
            <li>Medical workforce policy and reform</li>
          </ul>

          <h2>Contact</h2>
          <p>
            For editorial enquiries:{" "}
            <a href="mailto:anu@statdoctor.net">anu@statdoctor.net</a>
          </p>
          <p>
            Connect on{" "}
            <a
              href="https://www.linkedin.com/in/dr-anu-g-%F0%9F%A9%BA-3b330a248/"
              target="_blank"
              rel="noopener noreferrer"
            >
              LinkedIn
            </a>
          </p>
        </section>

        {/* Back to blog */}
        <div className="mt-12">
          <a
            href="/blog"
            className="text-sm font-medium text-blue-600 hover:text-blue-800"
          >
            &larr; Back to all articles
          </a>
        </div>
      </main>
    </>
  );
}
