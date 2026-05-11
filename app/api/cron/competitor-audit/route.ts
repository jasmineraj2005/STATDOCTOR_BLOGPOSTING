import { NextResponse } from "next/server";
import * as cheerio from "cheerio";
import { kv } from "@vercel/kv";
import OpenAI from "openai";
import { COMPETITOR_BLOG_INDEXES, type CompetitorSource } from "@/lib/competitor/sources";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const runtime = "nodejs";

type RawTitle = { competitor: string; publisher: string; title: string; href: string };

type ProposedTopic = {
  id: string;
  working_title: string;
  content_type: "guide" | "company";
  pillar: string;
  target_keywords: string[];
  competitor_inspiration: string[];
  source_titles: string[];
};

type AuditResult = {
  ts: string;
  raw_count: number;
  proposed_count: number;
  proposed: ProposedTopic[];
  per_competitor: Record<string, number>;
  errors: { competitor: string; error: string }[];
};

async function fetchTitles(src: CompetitorSource): Promise<RawTitle[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(src.url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; StatDoctorAudit/1.0)",
        Accept: "text/html",
      },
      redirect: "follow",
    });
    if (!res.ok) return [];
    const html = await res.text();
    const $ = cheerio.load(html);

    const collected = new Map<string, RawTitle>();

    // Try the configured selector first.
    $(src.selector).each((_i, el) => {
      const title = $(el).text().trim().replace(/\s+/g, " ");
      const href = ($(el).attr("href") ?? "").trim();
      if (title.length >= 20 && title.length <= 120 && !collected.has(title)) {
        collected.set(title, { competitor: src.name, publisher: src.publisher, title, href });
      }
    });

    // Fallback: every <a> inside <main>, length-filtered.
    if (collected.size === 0) {
      $("main a, body a").each((_i, el) => {
        const title = $(el).text().trim().replace(/\s+/g, " ");
        const href = ($(el).attr("href") ?? "").trim();
        if (title.length >= 20 && title.length <= 120 && !collected.has(title)) {
          collected.set(title, { competitor: src.name, publisher: src.publisher, title, href });
        }
      });
    }

    return Array.from(collected.values()).slice(0, 30);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

const CLUSTERING_PROMPT = `You are clustering competitor blog post titles into proposed evergreen topics for the StatDoctor blog.

StatDoctor is Australia's locum doctor marketplace. Our editorial pillars are:
- locum_pay_rates: pay benchmarks, salary, hourly/daily rates
- how_to_locum: AHPRA registration, indemnity, tax setup, first-shift checklist
- locum_by_location: state/city/region guides, RRMA incentives
- doctor_wellbeing: burnout, work-life balance, financial independence
- locum_vs_agency: marketplace vs agency, fees, buyout clauses
- company_pov: founder POV, marketplace mechanics (use sparingly)

content_type = "guide" for cornerstone evergreen reference content.
content_type = "company" for founder POV / marketplace-perspective content.

Given the raw competitor titles below, cluster them into 5-12 proposed topic-bank entries.
Skip topics that:
- Are obviously dated news (no decay value)
- Are non-locum-doctor topics (nursing, allied health, mental health for patients, etc.)
- Are clearly already in our bank (use the EXISTING_TOPICS list to dedupe)
- Are vague or click-baity ("5 things you didn't know")

Each proposed entry must be:
- Australia-relevant (or applicable to AU/NZ locum work)
- Concrete enough to write 2000+ words on
- Aligned to one of our pillars

Return ONLY a JSON object: { "proposed": [{ id, working_title, content_type, pillar, target_keywords, competitor_inspiration, source_titles }] }
- id: kebab-case, ≤ 50 chars, prefixed with "ext-" to mark external origin
- working_title: a clean rewrite, not the competitor's exact title
- target_keywords: 2-3 search-intent keywords
- competitor_inspiration: array of competitor names whose titles seeded this entry
- source_titles: array of 1-3 raw competitor titles that inspired this entry
`;

async function clusterTopics(
  raw: RawTitle[],
  existingIds: string[],
): Promise<ProposedTopic[]> {
  if (raw.length === 0) return [];
  if (!process.env.OPENAI_API_KEY) {
    return [];
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const userMessage = [
    `EXISTING_TOPICS (do not propose duplicates of these):\n${existingIds.join("\n")}`,
    "",
    `RAW COMPETITOR TITLES (${raw.length}):`,
    raw
      .map((r) => `- [${r.competitor}] ${r.title}`)
      .join("\n"),
  ].join("\n");

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: CLUSTERING_PROMPT },
        { role: "user", content: userMessage },
      ],
      temperature: 0.3,
    });
    const content = completion.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(content) as { proposed?: ProposedTopic[] };
    return Array.isArray(parsed.proposed) ? parsed.proposed : [];
  } catch {
    return [];
  }
}

export async function GET(req: Request) {
  // Vercel cron auth — verify the secret. Allow manual invocation if no
  // secret set (for local dev), but error otherwise.
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${expected}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const ts = new Date().toISOString();
  const errors: { competitor: string; error: string }[] = [];
  const perCompetitor: Record<string, number> = {};

  // Pull every competitor in parallel, time-boxed per fetch.
  const allTitles: RawTitle[] = [];
  await Promise.all(
    COMPETITOR_BLOG_INDEXES.map(async (src) => {
      try {
        const titles = await fetchTitles(src);
        perCompetitor[src.name] = titles.length;
        allTitles.push(...titles);
      } catch (e) {
        errors.push({ competitor: src.name, error: String(e) });
      }
    }),
  );

  // Pull existing topic IDs from KV (approved + previously proposed) so the
  // LLM can dedupe.
  let existingIds: string[] = [];
  try {
    const existing = (await kv.get<string[]>("competitor:existing-ids")) ?? [];
    existingIds = existing;
  } catch {
    // KV unavailable — proceed without dedupe context.
  }

  const proposed = await clusterTopics(allTitles, existingIds);

  const result: AuditResult = {
    ts,
    raw_count: allTitles.length,
    proposed_count: proposed.length,
    proposed,
    per_competitor: perCompetitor,
    errors,
  };

  // Persist to KV for the admin UI.
  try {
    await kv.set("competitor:proposed:latest", result);
    await kv.set(`competitor:runs:${ts}`, result, { ex: 60 * 60 * 24 * 90 }); // 90-day retention
  } catch {
    // KV unavailable — return result anyway so manual cron triggering still has output.
  }

  return NextResponse.json({
    ok: true,
    raw_count: result.raw_count,
    proposed_count: result.proposed_count,
    per_competitor: result.per_competitor,
    errors: result.errors,
  });
}
