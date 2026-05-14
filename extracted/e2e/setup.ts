/**
 * globalSetup — drops + recreates the Playwright test DB and seeds a clean
 * article into pending_review so the spec can drive a full review flow.
 *
 * Runs once before any tests. Idempotent: each run resets state.
 */

import { execSync } from "child_process";
import { Client } from "pg";

const DB_NAME = "statdoctor_admin_playwright";
const PUBLISH_DIR = "/tmp/sd-playwright-publish";

const DB_USER = process.env.USER ?? "postgres";
const PG_BIN = "/opt/homebrew/opt/postgresql@16/bin";

const sampleSlug = "playwright-locum-sydney";

async function dropAndCreate(): Promise<void> {
  execSync(`${PG_BIN}/dropdb --if-exists ${DB_NAME}`, { stdio: "inherit" });
  execSync(`${PG_BIN}/createdb ${DB_NAME}`, { stdio: "inherit" });
}

async function applySchema(): Promise<void> {
  const client = new Client({
    connectionString: `postgresql://${DB_USER}@localhost:5432/${DB_NAME}`,
  });
  await client.connect();
  try {
    const fs = await import("fs/promises");
    const path = await import("path");
    const schema = await fs.readFile(
      path.resolve(process.cwd(), "lib", "admin", "schema.sql"),
      "utf-8",
    );
    const stmts = schema
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n")
      .split(/;\s*\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const s of stmts) {
      await client.query(s);
    }
  } finally {
    await client.end();
  }
}

async function seedArticle(): Promise<void> {
  const client = new Client({
    connectionString: `postgresql://${DB_USER}@localhost:5432/${DB_NAME}`,
  });
  await client.connect();
  try {
    const now = new Date().toISOString();
    const post = {
      title: "Locum Work in Sydney — Playwright Test",
      slug: sampleSlug,
      meta_title: "Locum Work in Sydney",
      meta_description: "A$1600/day senior locum rates in Sydney for 2026.",
      focus_keyword: "locum work sydney",
      og_image_alt: "Sydney public hospital ward — locum scene.",
      content_markdown: [
        "**TL;DR:** test",
        "",
        "## Background",
        "[AHPRA](https://www.ahpra.gov.au/) is the entry point.",
        "",
        "> [KEY FACTS] Figures from AIHW.",
        "",
        "> [INFO] See [AIHW data](https://www.aihw.gov.au/) for context.",
        "",
        "> [AU] [NSW Health](https://www.health.nsw.gov.au/) sets the floor.",
        "",
        "> [KEY TAKEAWAY] Senior locums earn A$1600/day.",
        "",
        "## Pay",
        "",
        "| Tier | Daily |",
        "| --- | --- |",
        "| Junior | A$1100 |",
        "| Senior | A$1600 |",
        "",
        "## FAQ",
        "### Q1?",
        "A1.",
        "### Q2?",
        "A2.",
        "### Q3?",
        "A3.",
        "### Q4?",
        "A4.",
      ].join("\n"),
      tldr: "Playwright test post.",
      pillar: "locum_pay_rates",
      content_type: "guide",
      target_keywords: ["locum work sydney"],
      keywords: ["locum work sydney", "ahpra", "aihw"],
      twitter_card: null,
      word_count: 1600, // overshoots the 1500 floor so word_count passes
      reading_time_minutes: 8,
      sources: [
        { title: "AHPRA", url: "https://www.ahpra.gov.au/", publisher: "AHPRA", snippet: "" },
        { title: "AIHW", url: "https://www.aihw.gov.au/", publisher: "AIHW", snippet: "" },
        { title: "NSW Health", url: "https://www.health.nsw.gov.au/", publisher: "NSW Health", snippet: "" },
      ],
      image_url: null,
      image_credit: null,
      faq_json_ld: {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: [
          { "@type": "Question", name: "Q1?", acceptedAnswer: { "@type": "Answer", text: "A1" } },
          { "@type": "Question", name: "Q2?", acceptedAnswer: { "@type": "Answer", text: "A2" } },
          { "@type": "Question", name: "Q3?", acceptedAnswer: { "@type": "Answer", text: "A3" } },
          { "@type": "Question", name: "Q4?", acceptedAnswer: { "@type": "Answer", text: "A4" } },
        ],
      },
      medical_webpage_schema: { "@type": "MedicalWebPage" },
      ahpra_flags: [],
      ahpra_passed: true,
      status: "pending_review",
      generated_at: now,
      dateModified: now,
    };
    await client.query(
      `INSERT INTO posts (
        slug, filename, status, pillar, content_type, word_count, ahpra_passed,
        generated_at, date_modified, data
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)`,
      [
        post.slug,
        `20260514_120000_${post.slug}.json`,
        post.status,
        post.pillar,
        post.content_type,
        post.word_count,
        post.ahpra_passed,
        post.generated_at,
        post.dateModified,
        JSON.stringify(post),
      ],
    );
  } finally {
    await client.end();
  }
}

async function preparePublishDir(): Promise<void> {
  const fs = await import("fs/promises");
  await fs.mkdir(PUBLISH_DIR, { recursive: true });
  // Clear so the test can assert "JSON appeared after Approve."
  const entries = await fs.readdir(PUBLISH_DIR);
  await Promise.all(
    entries.map((e) => fs.unlink(`${PUBLISH_DIR}/${e}`).catch(() => undefined)),
  );
}

export default async function globalSetup() {
  await dropAndCreate();
  await applySchema();
  await seedArticle();
  await preparePublishDir();
  // Make the slug discoverable by the spec without re-deriving.
  process.env.E2E_SEED_SLUG = sampleSlug;
}
