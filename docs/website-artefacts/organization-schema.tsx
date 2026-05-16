/**
 * Drop-in Organization schema for ~/website/app/layout.tsx.
 *
 * This component renders a single <script type="application/ld+json"> block
 * in the root layout. It should be rendered ONCE, in the root layout, so
 * every page on statdoctor.app carries the Organization entity.
 *
 * Usage in ~/website/app/layout.tsx:
 *
 *   import { OrganizationSchema } from "@/components/OrganizationSchema";
 *
 *   export default function RootLayout({ children }) {
 *     return (
 *       <html lang="en-AU">
 *         <body>
 *           <OrganizationSchema />
 *           {children}
 *         </body>
 *       </html>
 *     );
 *   }
 *
 * -------------------------------------------------------------------------
 * Judgment calls:
 *
 * @type "MedicalBusiness":
 *   More specific than "Organization". schema.org defines MedicalBusiness as
 *   a LocalBusiness that is a medical organization. StatDoctor is a healthcare
 *   marketplace — this is accurate and gives Google more signal than plain
 *   Organization. It's a subtype of both LocalBusiness and MedicalOrganization.
 *   See: https://schema.org/MedicalBusiness
 *
 * medicalSpecialty:
 *   schema.org MedicalSpecialty enum. "FamilyPractice" and "Emergency" are the
 *   closest matches for a locum platform serving GPs and emergency physicians.
 *   Full enum: https://schema.org/MedicalSpecialty
 *   If StatDoctor expands to other specialties (e.g. anaesthetics, psychiatry),
 *   add them here.
 *
 * address: PLACEHOLDER — fill in the registered business address once known.
 *   If StatDoctor is not incorporated with a physical address, a PO Box or
 *   registered agent address is acceptable. Do NOT leave this empty in
 *   production — Google uses it for local entity disambiguation.
 *
 * sameAs ABN Lookup URL format:
 *   https://abr.business.gov.au/ABN/View?abn=<ABN_WITHOUT_SPACES>
 *   e.g. https://abr.business.gov.au/ABN/View?abn=12345678901
 *   Retrieve the ABN from ASIC or the company's registration documents.
 *
 * sameAs ASIC URL format:
 *   https://connectonline.asic.gov.au/RegistrySearch/faces/landing/SearchRegisters.jspx?_adf.ctrl-state=...
 *   In practice, ASIC URLs are session-based and not stable. Only add ASIC if
 *   you have a direct stable link (some company searches have stable ACN links).
 *   Omit if you can't find a stable URL.
 *
 * logo: points to statdoctor.app — use the canonical production URL, not a CDN
 *   or Vercel blob URL. Upload the logo to ~/website/public/images/logo.png
 *   and reference it as https://statdoctor.app/images/logo.png.
 *   Recommended: SVG or PNG, minimum 112×112 px, maximum 600×60 px for
 *   Knowledge Panel display.
 *
 * Google March 2026 update context:
 *   After the March 2026 core update, entity disambiguation via Organization
 *   schema with verified sameAs links became more important for YMYL sites.
 *   The @id on this Organization must match the @id referenced in:
 *   - author-page.tsx (worksFor @id)
 *   - medical-scholarly-article.tsx (publisher @id)
 *   All three must share "@id": "https://statdoctor.app/#organization"
 * -------------------------------------------------------------------------
 */

const organizationSchema = {
  "@context": "https://schema.org",
  "@type": "MedicalBusiness",
  "@id": "https://statdoctor.app/#organization",

  name: "StatDoctor",
  alternateName: "StatDoctor — Australia's Zero-Commission Locum Marketplace",
  url: "https://statdoctor.app/",
  email: "mailto:anu@statdoctor.net",

  logo: {
    "@type": "ImageObject",
    url: "https://statdoctor.app/images/logo.png",
    // PLACEHOLDER: replace with actual logo URL once uploaded to ~/website/public/images/logo.png
  },

  // medicalSpecialty uses the schema.org MedicalSpecialty enum.
  // "FamilyPractice" covers GP/general practice locums (highest volume on platform).
  // "Emergency" covers emergency physician and ED locums.
  medicalSpecialty: ["FamilyPractice", "Emergency"],

  address: {
    "@type": "PostalAddress",
    // PLACEHOLDER: fill in the registered business address.
    // Use the address on file with ASIC or the ATO.
    // If Brisbane-based (per HANDOVER.md), start with:
    addressLocality: "Brisbane",
    addressRegion: "QLD",
    postalCode: "4000",
    // PLACEHOLDER: replace 4000 with actual postcode
    addressCountry: "AU",
    // streetAddress: "PLACEHOLDER — add once known",
  },

  areaServed: {
    "@type": "Country",
    name: "Australia",
  },

  sameAs: [
    // LinkedIn company page — PLACEHOLDER: replace with actual company page URL.
    // StatDoctor may not have a LinkedIn company page yet; add once created.
    // Format: "https://www.linkedin.com/company/<company-slug>/"
    // "https://www.linkedin.com/company/statdoctor/",

    // ABN Lookup — PLACEHOLDER: replace <ABN> with StatDoctor's 11-digit ABN.
    // Format: https://abr.business.gov.au/ABN/View?abn=<ABN_WITHOUT_SPACES>
    // "https://abr.business.gov.au/ABN/View?abn=PLACEHOLDER",

    // App Store listing (if the app exists):
    // "https://apps.apple.com/au/app/statdoctor/idPLACEHOLDER",

    // Google Play listing (if applicable):
    // "https://play.google.com/store/apps/details?id=app.statdoctor",

    // ASIC company search (only if you have a stable direct link):
    // "https://connectonline.asic.gov.au/...",
  ],
  // NOTE: sameAs is deliberately empty until the real URLs are confirmed.
  // Adding placeholder URLs would be worse than an empty array — Google
  // validates sameAs links and penalises broken or mismatched ones.

  founder: {
    "@id": "https://statdoctor.app/about#anu",
    // References the Person entity defined in author-page.tsx
  },

  description:
    "StatDoctor is Australia's zero-commission locum doctor marketplace. We connect AHPRA-registered doctors with hospitals, GP clinics, and health facilities across Australia — without the agency fees.",
};

export function OrganizationSchema(): JSX.Element {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }}
    />
  );
}
