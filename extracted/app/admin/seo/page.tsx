export const dynamic = "force-dynamic";

export default function SeoPlaceholder() {
  return (
    <main className="min-h-[60vh] pt-24 pb-32 px-6">
      <div className="max-w-[1100px] mx-auto">
        <div className="eyebrow text-ocean mb-3">Search performance</div>
        <h1 className="display text-4xl md:text-5xl mb-4">SEO progress</h1>
        <p className="text-muted text-sm max-w-xl">
          Placeholder. Daily Google Search Console + Bing Webmaster snapshots will land
          here once the cron is wired and the site is verified.
        </p>
      </div>
    </main>
  );
}
