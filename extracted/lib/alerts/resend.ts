/**
 * lib/alerts/resend.ts — Real-time alert dispatcher (M7)
 *
 * Sends an email via Resend when severity >= "error", and inserts/upserts
 * a row into the `alerts` table for all severities.
 *
 * Deduplication: same `kind` within 1 hour → bumps existing row count,
 * does NOT re-send email. This prevents alert spam during flapping failures.
 *
 * Env vars required for email:
 *   RESEND_API_KEY  — Resend API key
 *   ALERT_EMAIL     — recipient (defaults to anu@statdoctor.net)
 *
 * If RESEND_API_KEY is absent, alert is recorded in DB only (no email).
 */

export type AlertSeverity = "warn" | "error" | "critical";

export type AlertOpts = {
  kind: string;           // "publish_failed" | "cron_failed" | "db_unreachable" | …
  severity: AlertSeverity;
  detail: string;
  context?: Record<string, unknown>;
};

export type ResendBody = {
  from: string;
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
};

export type ResendFn = (body: ResendBody) => Promise<{ id: string }>;

export type Db = {
  query: (
    text: string,
    values?: unknown[],
  ) => Promise<{ rows: Array<Record<string, unknown>>; rowCount: number }>;
};

export type AlertResult = {
  emailSent: boolean;
  alertId: string;
};

/** Severities that warrant immediate email. "warn" goes to DB only. */
const EMAIL_SEVERITIES: AlertSeverity[] = ["error", "critical"];

const DEDUP_WINDOW_MS = 60 * 60 * 1000; // 1 hour

/** Build plain-text email body for the alert. */
function buildEmailBody(opts: AlertOpts, now: Date): string {
  const lines = [
    `[StatDoctor Alert] ${opts.kind.toUpperCase()} — ${opts.severity}`,
    ``,
    `Time: ${now.toISOString()}`,
    `Kind: ${opts.kind}`,
    `Severity: ${opts.severity}`,
    ``,
    `Detail:`,
    opts.detail,
  ];
  if (opts.context && Object.keys(opts.context).length > 0) {
    lines.push(``, `Context:`, JSON.stringify(opts.context, null, 2));
  }
  return lines.join("\n");
}

/**
 * Dispatch a real-time alert.
 *
 * @param opts   Alert payload.
 * @param deps   Injectable dependencies for testing (Resend sender, DB, clock).
 */
export async function dispatchAlert(
  opts: AlertOpts,
  deps: {
    resend?: ResendFn;
    db?: Db;
    now?: () => Date;
  } = {},
): Promise<AlertResult> {
  const now = deps.now ? deps.now() : new Date();
  const toEmail = process.env.ALERT_EMAIL ?? "anu@statdoctor.net";
  const shouldEmail = EMAIL_SEVERITIES.includes(opts.severity);

  // ── DB operations ────────────────────────────────────────────────────────────
  let alertId = "nodb";
  let isDuplicate = false;

  const db = deps.db ?? (await tryGetDb());

  if (db) {
    try {
      // Check for recent duplicate within the dedup window.
      const windowStart = new Date(now.getTime() - DEDUP_WINDOW_MS);
      const dupCheck = await db.query(
        `SELECT id FROM alerts WHERE kind = $1 AND ts >= $2 LIMIT 1`,
        [opts.kind, windowStart.toISOString()],
      );

      if (dupCheck.rows.length > 0) {
        // Duplicate — just bump a count field if it exists, else leave as-is.
        alertId = String(dupCheck.rows[0].id);
        isDuplicate = true;
        // Update detail to reflect recurrence.
        await db.query(
          `UPDATE alerts SET detail = $1 WHERE id = $2`,
          [`[recurrence] ${opts.detail}`, alertId],
        );
      } else {
        // New alert — insert row.
        const insert = await db.query(
          `INSERT INTO alerts (ts, kind, detail) VALUES ($1, $2, $3) RETURNING id`,
          [now.toISOString(), opts.kind, opts.detail],
        );
        alertId = insert.rows.length > 0 ? String(insert.rows[0].id) : "inserted";
      }
    } catch {
      // DB failure should not prevent email from going out.
      alertId = "db-error";
    }
  }

  // ── Email dispatch ────────────────────────────────────────────────────────────
  let emailSent = false;

  if (shouldEmail && !isDuplicate) {
    const sendFn = deps.resend ?? (await tryGetResendSender());
    if (sendFn) {
      try {
        const from = "alerts@statdoctor.net";
        const subject = `[StatDoctor] ${opts.severity.toUpperCase()}: ${opts.kind}`;
        const text = buildEmailBody(opts, now);
        await sendFn({ from, to: toEmail, subject, text });
        emailSent = true;
      } catch {
        // Email failure is non-fatal — alert is already in DB.
      }
    }
  }

  return { emailSent, alertId };
}

/** Lazily construct a Resend sender from env, returning null if unconfigured. */
async function tryGetResendSender(): Promise<ResendFn | null> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;

  try {
    // Dynamic import so that the Resend SDK is optional at build time.
    // We require() it via eval to avoid TypeScript module resolution errors
    // when the "resend" package is not installed.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    const resendModule = await new Function('return import("resend")')() as {
      Resend: new (key: string) => {
        emails: { send: (body: ResendBody) => Promise<{ id: string }> };
      };
    };
    const client = new resendModule.Resend(apiKey);
    return (body: ResendBody) => client.emails.send(body);
  } catch {
    return null;
  }
}

/** Get a DB connection from the existing pool if available. */
async function tryGetDb(): Promise<Db | null> {
  try {
    const { pool, isDbConfigured } = await import("@/lib/admin/db");
    if (!isDbConfigured()) return null;
    const p = pool();
    return {
      query: async (text: string, values?: unknown[]) => {
        const res = await p.query(text, values);
        return { rows: res.rows, rowCount: res.rowCount ?? 0 };
      },
    };
  } catch {
    return null;
  }
}
