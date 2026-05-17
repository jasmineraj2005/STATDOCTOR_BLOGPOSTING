import { NextResponse } from "next/server";
import { getAllPosts, getPendingPosts } from "@/lib/admin/store";
import { recordCronRun } from "@/lib/admin/cron";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Sunday 7am AEST reminder email.
 *
 *   GET /api/cron/sunday-reminder
 *   Authorization: Bearer ${CRON_SECRET}
 *
 * Fired by `.github/workflows/cron-sunday-reminder.yml` every Sat 21:00 UTC
 * (= 07:00 Sun AEST / 06:00 Sun AEDT). Sends a short email to the CEO with:
 *   - count of articles ready for review (pending_review only — healing/
 *     heal_failed counted separately)
 *   - direct link to the review queue at https://blog.statdoctor.app/admin/posts
 *   - count of articles published in the past 7 days
 *
 * Designed for the 20-30 min Sunday review window. Soft, single email.
 * If RESEND_API_KEY is missing, the function logs the would-be email and
 * exits clean — no failures, no alerts.
 */
const SITE_URL = "https://blog.statdoctor.app";
const REVIEW_URL = `${SITE_URL}/admin/posts`;

export async function GET(req: Request) {
  const expected = process.env.CRON_SECRET;
  const provided = req.headers.get("authorization") ?? "";
  if (!expected || provided !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const [pending, all] = await Promise.all([getPendingPosts(), getAllPosts()]);
  const healing = all.filter((f) => f.post.status === "pending_heal").length;
  const healFailed = all.filter((f) => f.post.status === "heal_failed").length;
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const publishedThisWeek = all.filter(
    (f) =>
      f.post.status === "published" &&
      new Date(f.post.dateModified ?? f.post.generated_at).getTime() > sevenDaysAgo,
  ).length;

  const subject = `[StatDoctor] Sunday queue ready — ${pending.length} article${pending.length === 1 ? "" : "s"} to review`;
  const html = renderReminderEmail({
    pending: pending.length,
    healing,
    healFailed,
    publishedThisWeek,
    reviewUrl: REVIEW_URL,
    siteUrl: SITE_URL,
  });

  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.DIGEST_EMAIL_TO;
  const from =
    process.env.DIGEST_EMAIL_FROM ?? "StatDoctor Editorial <digest@statdoctor.app>";

  let sent: { ok: boolean; detail: string };
  if (!apiKey || !to) {
    sent = { ok: false, detail: "RESEND_API_KEY or DIGEST_EMAIL_TO not set; reminder logged not sent" };
    console.log(`[sunday-reminder] ${sent.detail} — would have sent to=${to ?? "?"}, subject=${subject}`);
  } else {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to, subject, html }),
      });
      const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
      sent = res.ok
        ? { ok: true, detail: `Resend id=${body.id ?? "?"}` }
        : { ok: false, detail: `Resend ${res.status}: ${body.message ?? "error"}` };
    } catch (e) {
      sent = { ok: false, detail: `Resend fetch threw: ${String(e)}` };
    }
  }

  await recordCronRun("sunday-reminder", sent.ok, sent.detail);

  return NextResponse.json({
    ok: sent.ok,
    subject,
    pending: pending.length,
    healing,
    heal_failed: healFailed,
    published_this_week: publishedThisWeek,
    detail: sent.detail,
  });
}

export function renderReminderEmail(opts: {
  pending: number;
  healing: number;
  healFailed: number;
  publishedThisWeek: number;
  reviewUrl: string;
  siteUrl: string;
}): string {
  const { pending, healing, healFailed, publishedThisWeek, reviewUrl, siteUrl } = opts;

  const headline =
    pending === 0
      ? "Nothing to review this week — the pipeline ran but every article healed itself green."
      : `${pending} article${pending === 1 ? "" : "s"} ready for review.`;

  const healLine =
    healing > 0 || healFailed > 0
      ? `<p style="margin:8px 0;color:#555;font-size:14px;">
          ${healing > 0 ? `${healing} still healing` : ""}${healing > 0 && healFailed > 0 ? " · " : ""}${healFailed > 0 ? `<strong style="color:#b91c1c;">${healFailed} heal-failed (needs manual edit)</strong>` : ""}
         </p>`
      : "";

  return `<!doctype html>
<html>
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #0a0a0a;">
    <h1 style="font-size:22px; margin:0 0 6px 0; letter-spacing:-0.01em;">Good morning, Anu.</h1>
    <p style="margin:0 0 18px 0; color:#444; font-size:15px;">Sunday review — your weekly editorial window.</p>

    <div style="background:#f5f3ff; border:1px solid #c4b5fd; border-radius:12px; padding:18px 20px; margin:16px 0;">
      <div style="font-size:20px; font-weight:600; color:#5b21b6;">${headline}</div>
      ${healLine}
    </div>

    <p style="margin:16px 0;">
      <a href="${reviewUrl}" style="display:inline-block; background:#5b21b6; color:#ffffff; padding:12px 22px; border-radius:999px; text-decoration:none; font-weight:600; font-size:14px;">
        Open review queue →
      </a>
    </p>

    <p style="margin:18px 0 6px 0; color:#666; font-size:14px;">
      Published this week: <strong>${publishedThisWeek}</strong>${publishedThisWeek > 0 ? ` — see them live at <a href="${siteUrl}" style="color:#5b21b6;">${siteUrl.replace(/^https?:\/\//, "")}</a>` : ""}.
    </p>

    <hr style="border:none; border-top:1px solid #eee; margin:24px 0;" />
    <p style="font-size:12px; color:#888; margin:4px 0;">
      The 4-layer fail-agent system runs continuously. Articles that can self-heal are patched automatically; you only see what's truly ready for human judgment.
    </p>
    <p style="font-size:11px; color:#aaa; margin:4px 0;">
      Sent every Sunday at 7am AEST. Cron: <code>cron-sunday-reminder.yml</code>. Quiet this by disabling the workflow in GH Actions.
    </p>
  </body>
</html>`;
}
