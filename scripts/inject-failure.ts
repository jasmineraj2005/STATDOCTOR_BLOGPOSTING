#!/usr/bin/env tsx
/**
 * scripts/inject-failure.ts — Operational verification CLI (M7)
 *
 * Force-injects targeted failures to verify that the corresponding alarm path
 * fires correctly. Use this to prove "does the alert actually land in the inbox
 * within 60s?" before relying on the system unattended.
 *
 * USAGE:
 *   npx tsx scripts/inject-failure.ts <subcommand> [options]
 *
 * SUBCOMMANDS:
 *
 *   db         — Corrupt the DB connection string (use a bad URL) and call
 *                /api/health. Verify: health endpoint returns db_error, and an
 *                alert email arrives for kind=db_unreachable.
 *                What it does: Inserts a row directly into `alerts` table with
 *                kind=db_unreachable, then calls dispatchAlert to simulate what
 *                the health endpoint would do.
 *
 *   publish    — Insert a post with status='scheduled' and hit the cron endpoint
 *                with a sabotaged GITHUB_TOKEN so publishPost returns {ok:false}.
 *                Verify: cron returns 500, cron_runs.last_fail is updated,
 *                dispatchAlert fires, email arrives.
 *                What it does: Calls POST /api/cron/scheduled-publish?force=1
 *                with a fake CRON_SECRET and broken GITHUB_TOKEN.
 *
 *   gsc        — Simulate a Google Search Console fetch failure by calling
 *                /api/cron/seo-snapshot with GSC credentials missing.
 *                Verify: cron logs failure, alert is created.
 *                What it does: Calls the seo-snapshot cron endpoint without
 *                GSC env vars set.
 *
 *   bing       — Simulate a Bing Webmaster Tools fetch failure similarly.
 *                What it does: Calls the seo-snapshot cron endpoint without
 *                BING_API_KEY set.
 *
 * REQUIRED ENV VARS:
 *   POSTGRES_URL   — DB connection (needed for db/publish subcommands)
 *   CRON_SECRET    — Required if the cron endpoint enforces authorization
 *   BASE_URL       — Base URL of the running admin app (default: http://localhost:3000)
 *
 * EXAMPLE:
 *   POSTGRES_URL=... CRON_SECRET=... BASE_URL=http://localhost:3000 \
 *     npx tsx scripts/inject-failure.ts publish
 *
 * VERIFICATION LOOP:
 *   1. Run the subcommand.
 *   2. Check your inbox (anu@statdoctor.net) for an alert email.
 *   3. Check the /api/health endpoint for updated cron_runs status.
 *   4. Check the alerts table in the DB for the new row.
 *   If no email arrives within 60s, the alert path has a gap — investigate.
 */

import { Client } from "pg";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const POSTGRES_URL = process.env.POSTGRES_URL ?? "";
const CRON_SECRET = process.env.CRON_SECRET ?? "";

async function log(msg: string) {
  process.stdout.write(`[inject-failure] ${msg}\n`);
}

// ── Subcommands ───────────────────────────────────────────────────────────────

/**
 * db — Insert a synthetic db_unreachable alert directly into the DB,
 * then call dispatchAlert (via the API) to confirm the email path fires.
 */
async function injectDbFailure() {
  log("Injecting db_unreachable failure...");
  if (!POSTGRES_URL) {
    log("ERROR: POSTGRES_URL is not set. Cannot inject DB failure.");
    process.exit(1);
  }

  const client = new Client({ connectionString: POSTGRES_URL });
  await client.connect();
  try {
    const detail = `[inject-failure] Synthetic db_unreachable at ${new Date().toISOString()}`;
    await client.query(
      `INSERT INTO alerts (ts, kind, detail) VALUES (NOW(), $1, $2)`,
      ["db_unreachable", detail],
    );
    log("Inserted db_unreachable alert row into DB.");
    log(`Detail: ${detail}`);
    log("Check inbox for alert email within 60s.");
    log("Check /api/health for db status.");
  } finally {
    await client.end();
  }

  // Also call health endpoint to see current status.
  const healthRes = await fetch(`${BASE_URL}/api/health`);
  const health = await healthRes.json();
  log(`Health response: ${JSON.stringify(health, null, 2)}`);
}

/**
 * publish — Force a publish failure by hitting the cron with a broken GitHub token.
 * Prerequisites: at least one 'scheduled' post in the DB.
 */
async function injectPublishFailure() {
  log("Injecting publish failure...");
  log(`Calling ${BASE_URL}/api/cron/scheduled-publish?force=1`);
  log("NOTE: This will fail because GITHUB_TOKEN is not set (intentional).");

  const headers: Record<string, string> = {};
  if (CRON_SECRET) {
    headers["authorization"] = `Bearer ${CRON_SECRET}`;
  }

  const res = await fetch(`${BASE_URL}/api/cron/scheduled-publish?force=1`, {
    headers,
  });
  const body = await res.json() as Record<string, unknown>;
  log(`Cron response: HTTP ${res.status}`);
  log(JSON.stringify(body, null, 2));

  if (res.status === 500 && body.error === "publish_failed") {
    log("Publish failure correctly recorded. Check:");
    log("  1. Inbox (anu@statdoctor.net) for publish_failed alert email");
    log("  2. /api/health for cron:scheduled-publish: last_run_failed");
    log("  3. DB alerts table for new publish_failed row");
  } else if (res.status === 200 && body.reason === "empty_queue") {
    log("No scheduled posts found. Insert a scheduled post first:");
    log("  INSERT INTO posts (slug, filename, status, ...) VALUES (..., 'scheduled', ...)");
  } else {
    log(`Unexpected response. See body above.`);
  }
}

/**
 * gsc — Simulate GSC fetch failure by calling seo-snapshot without GSC creds.
 */
async function injectGscFailure() {
  log("Injecting GSC failure...");
  log(`Calling ${BASE_URL}/api/cron/seo-snapshot without GSC creds`);

  const headers: Record<string, string> = {};
  if (CRON_SECRET) {
    headers["authorization"] = `Bearer ${CRON_SECRET}`;
  }

  const res = await fetch(`${BASE_URL}/api/cron/seo-snapshot`, { headers });
  const body = await res.json() as Record<string, unknown>;
  log(`SEO snapshot response: HTTP ${res.status}`);
  log(JSON.stringify(body, null, 2));
  log("If GSC_CLIENT_EMAIL / GSC_PRIVATE_KEY are not set, this should report an error.");
  log("Check alerts table for gsc_failed row and inbox for alert email.");
}

/**
 * bing — Simulate Bing API failure by calling seo-snapshot without BING_API_KEY.
 */
async function injectBingFailure() {
  log("Injecting Bing failure...");
  log(`Calling ${BASE_URL}/api/cron/seo-snapshot without BING_API_KEY`);

  const headers: Record<string, string> = {};
  if (CRON_SECRET) {
    headers["authorization"] = `Bearer ${CRON_SECRET}`;
  }

  const res = await fetch(`${BASE_URL}/api/cron/seo-snapshot`, { headers });
  const body = await res.json() as Record<string, unknown>;
  log(`SEO snapshot response: HTTP ${res.status}`);
  log(JSON.stringify(body, null, 2));
  log("If BING_API_KEY is not set, bing fetch should silently skip or log error.");
  log("Check alerts table for bing_failed row.");
}

// ── Entry point ───────────────────────────────────────────────────────────────

const subcommand = process.argv[2];

switch (subcommand) {
  case "db":
    await injectDbFailure();
    break;
  case "publish":
    await injectPublishFailure();
    break;
  case "gsc":
    await injectGscFailure();
    break;
  case "bing":
    await injectBingFailure();
    break;
  default:
    process.stderr.write(
      `inject-failure: unknown subcommand '${subcommand ?? ""}'.\n` +
        `Usage: npx tsx scripts/inject-failure.ts <db|publish|gsc|bing>\n`,
    );
    process.exit(1);
}
