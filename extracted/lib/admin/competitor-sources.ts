/**
 * Competitor blog index URLs + selectors used by the audit cron.
 * Selectors verified manually before deploy. If a selector misses (returns
 * 0 titles), the audit falls back to "all <a> tags inside <main> filtered
 * by title length 20–120 chars".
 */

export type CompetitorSource = {
  name: string;
  publisher: string;
  url: string;
  selector: string;
};

export const COMPETITOR_BLOG_INDEXES: CompetitorSource[] = [
  // Australian competitors
  { name: "hopmedic", publisher: "Hopmedic", url: "https://hopmedic.com/blog", selector: "article h2 a, .post-card-title a" },
  { name: "golocum", publisher: "Go Locum", url: "https://golocum.com.au/blog", selector: ".post-title a, article h3 a" },
  { name: "wavelength", publisher: "Wavelength International", url: "https://wave.com.au/blog", selector: "article h3 a, .post-title a" },
  { name: "medrecruit", publisher: "Medrecruit", url: "https://medrecruit.medworld.com/insights", selector: ".article-card a, article h3 a" },
  { name: "blugibbon", publisher: "Blugibbon", url: "https://www.blugibbon.com.au/blog", selector: "h2 a, article h3 a" },
  { name: "locumate", publisher: "Locumate", url: "https://locumate.ai/blog", selector: "article a, .blog-card a" },

  // International benchmarks
  { name: "patchwork", publisher: "Patchwork Health", url: "https://patchwork.health/blog", selector: "h3 a, article h2 a" },
  { name: "nomad", publisher: "Nomad Health", url: "https://nomadhealth.com/blog", selector: "article a, .blog-post-title a" },
  { name: "shiftkey", publisher: "ShiftKey", url: "https://www.shiftkey.com/blog", selector: "h2 a, article h3 a" },
];
