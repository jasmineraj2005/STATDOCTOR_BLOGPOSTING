import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isAuthorised } from "@/lib/admin/auth";
import { getPostBySlug, getPostRevisions, type PostRevision } from "@/lib/admin/store";
import { runValidators, isApprovable, type ValidationResult } from "@/lib/admin/validators";
import {
  CONTENT_TYPE_LABELS,
  PILLAR_LABELS,
  REJECTION_LABELS,
  type RejectionCode,
} from "@/lib/admin/types";
import ArticlePreviewPane from "@/components/article-preview-pane";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function PostEditPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  if (!(await isAuthorised())) redirect("/login");

  const { slug } = await params;
  const file = await getPostBySlug(slug);
  if (!file) notFound();

  const { post } = file;
  const validators = runValidators(post);
  const approvable = isApprovable(validators);

  // M9 finish: surface the post_revisions history (newest first).
  const revisions = await getPostRevisions(slug);

  // Compact validator summary for the top action bar.
  const validatorTally = {
    pass: validators.filter((r) => r.status === "pass").length,
    warn: validators.filter((r) => r.status === "warn").length,
    fail: validators.filter((r) => r.status === "fail").length,
  };
  const hasHistory = !!(post.rejection_history && post.rejection_history.length > 0);
  const hasRevisions = revisions.length > 0;

  return (
    <main className="min-h-[calc(100vh-3.5rem)] bg-white pt-8 pb-32 px-6">
      <div className="max-w-[1100px] mx-auto">
        <Link
          href="/admin/posts"
          className="inline-block text-[10px] font-semibold tracking-widest uppercase text-indigo-600 hover:underline"
        >
          ← Back to queue
        </Link>

        {/* Page header — title + content-type chips + APPROVE / HEAL */}
        <div className="mt-4 flex items-start justify-between gap-6 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <span className="px-2 py-0.5 rounded bg-violet-100 text-violet-700 text-[9px] font-semibold tracking-widest uppercase">
                {CONTENT_TYPE_LABELS[post.content_type]}
              </span>
              <span className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-600 text-[9px] font-semibold tracking-widest uppercase">
                {PILLAR_LABELS[post.pillar] ?? post.pillar}
              </span>
              <span className="text-[10px] text-gray-500 font-mono">
                {post.status} · {post.word_count} words · {post.reading_time_minutes} min
              </span>
            </div>
            <h1 className="text-3xl md:text-4xl font-semibold text-gray-900 leading-tight">
              {post.title}
            </h1>
            {/* TL;DR removed from header — the rendered preview shows it in a
                styled callout box (article-preview-pane.tsx). One source for the
                TL;DR avoids drift between header and body. */}
          </div>
          <div className="flex gap-2">
            {!approvable && (
              <form action={`/api/posts/${post.slug}/heal`} method="POST">
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-full bg-amber-500 text-white text-[10px] font-semibold tracking-widest hover:bg-amber-600 transition-colors"
                  title="Re-run the writer with the failing validators as feedback. Refresh in ~90s."
                >
                  HEAL
                </button>
              </form>
            )}
            <form action={`/api/posts/${post.slug}/approve`} method="POST">
              <button
                type="submit"
                disabled={!approvable}
                className="px-5 py-2.5 rounded-full bg-indigo-600 text-white text-[10px] font-semibold tracking-widest hover:bg-indigo-800 transition-colors disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed"
                title={
                  approvable
                    ? "Approve and publish to website"
                    : "Validators must all pass before approval — try the HEAL button to fix automatically"
                }
              >
                APPROVE &amp; PUBLISH
              </button>
            </form>
          </div>
        </div>

        {/* ── Jump-link chips — quick navigation to the panels below ──────── */}
        <nav className="mt-5 flex flex-wrap gap-2 items-center text-[10px] font-semibold tracking-widest uppercase">
          <span className="text-gray-400">Jump to:</span>
          <a
            href="#validators"
            className="px-3 py-1 rounded-full border border-gray-200 hover:bg-indigo-50 hover:border-indigo-300 hover:text-indigo-700 text-gray-600 inline-flex items-center gap-2"
          >
            <span>Validators</span>
            <span className="flex gap-1" aria-label="validator status counts">
              {validatorTally.fail > 0 && (
                <span className="px-1.5 rounded bg-red-100 text-red-700">{validatorTally.fail} fail</span>
              )}
              {validatorTally.warn > 0 && (
                <span className="px-1.5 rounded bg-amber-100 text-amber-700">{validatorTally.warn} warn</span>
              )}
              {validatorTally.fail === 0 && validatorTally.warn === 0 && (
                <span className="px-1.5 rounded bg-emerald-100 text-emerald-700">all green</span>
              )}
            </span>
          </a>
          <a
            href="#reject"
            className="px-3 py-1 rounded-full border border-gray-200 hover:bg-indigo-50 hover:border-indigo-300 hover:text-indigo-700 text-gray-600"
          >
            Reject
          </a>
          {hasHistory && (
            <a
              href="#history"
              className="px-3 py-1 rounded-full border border-gray-200 hover:bg-indigo-50 hover:border-indigo-300 hover:text-indigo-700 text-gray-600"
            >
              History ({post.rejection_history!.length})
            </a>
          )}
          {hasRevisions && (
            <a
              href="#revisions"
              className="px-3 py-1 rounded-full border border-gray-200 hover:bg-indigo-50 hover:border-indigo-300 hover:text-indigo-700 text-gray-600"
            >
              Revisions ({revisions.length})
            </a>
          )}
          <a
            href="#edit"
            className="px-3 py-1 rounded-full border border-gray-200 hover:bg-indigo-50 hover:border-indigo-300 hover:text-indigo-700 text-gray-600"
          >
            Edit
          </a>
        </nav>

        {/* ── Article preview — full-width, readable column ───────────────── */}
        <section className="mt-8">
          <ArticlePreviewPane post={post} />
        </section>

        {/* ── Below-fold review panels — anchored for top-nav jump-links ──── */}
        <section id="validators" className="mt-12 scroll-mt-24">
          <ValidatorPanel results={validators} />
        </section>

        <section id="reject" className="mt-6 scroll-mt-24">
          <RejectForm slug={post.slug} />
        </section>

        {hasHistory && (
          <section id="history" className="mt-6 scroll-mt-24">
            <RejectionHistory entries={post.rejection_history!} />
          </section>
        )}

        {hasRevisions && (
          <section id="revisions" className="mt-6 scroll-mt-24">
            <RevisionsPanel revisions={revisions} />
          </section>
        )}

        {/* ── Editor form — foldable, below the preview ────────────────────── */}
        {/* Default closed so the CEO reads the rendered article first and only
            opens the editor if they need to tweak metadata or markdown. */}
        <details
          id="edit"
          className="mt-10 rounded-2xl border border-gray-200 bg-white shadow-sm scroll-mt-24"
          data-testid="editor-fold"
        >
          <summary className="flex cursor-pointer select-none items-center justify-between px-6 py-4 text-sm font-semibold text-gray-700 hover:bg-gray-50 rounded-2xl">
            <span>Edit content</span>
            <span className="text-gray-400 text-xs font-mono tracking-widest uppercase">
              meta · keywords · markdown
            </span>
          </summary>

          <div className="px-6 pb-6 pt-2">
            <form action={`/api/posts/${post.slug}/edit`} method="POST" className="space-y-4">
              <label className="block">
                <span className="text-[10px] font-semibold tracking-widest uppercase text-gray-500">
                  meta_title (≤60)
                </span>
                <input
                  name="meta_title"
                  defaultValue={post.meta_title}
                  maxLength={60}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm text-gray-900"
                />
              </label>
              <label className="block">
                <span className="text-[10px] font-semibold tracking-widest uppercase text-gray-500">
                  meta_description (≤155)
                </span>
                <textarea
                  name="meta_description"
                  defaultValue={post.meta_description}
                  maxLength={155}
                  rows={2}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm text-gray-900"
                />
              </label>
              <label className="block">
                <span className="text-[10px] font-semibold tracking-widest uppercase text-gray-500">
                  keywords (comma-sep, 5–8)
                </span>
                <input
                  name="keywords"
                  defaultValue={(post.keywords ?? []).join(", ")}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm text-gray-900"
                />
              </label>
              <label className="block">
                <span className="text-[10px] font-semibold tracking-widest uppercase text-gray-500">
                  content_markdown
                </span>
                <textarea
                  name="content_markdown"
                  defaultValue={post.content_markdown}
                  rows={28}
                  className="mt-1 w-full px-3 py-3 rounded-lg border border-gray-200 bg-white text-[13px] font-mono leading-relaxed text-gray-900"
                />
              </label>
              <button
                type="submit"
                className="px-4 py-2 rounded-full bg-gray-900 text-white text-[10px] font-semibold tracking-widest hover:bg-indigo-600 transition-colors"
              >
                SAVE EDITS &amp; RE-VALIDATE
              </button>
            </form>
          </div>
        </details>
      </div>
    </main>
  );
}

function ValidatorPanel({ results }: { results: ValidationResult[] }) {
  return (
    <div className="rounded-2xl bg-white border border-gray-200 p-5">
      <h3 className="text-[10px] font-semibold tracking-widest uppercase text-indigo-600 mb-3">Validators</h3>
      <ul className="space-y-3">
        {results.map((r) => {
          const dotClass =
            r.status === "pass"
              ? "bg-leaf"
              : r.status === "warn"
                ? "bg-electric"
                : "bg-red-500";
          return (
            <li key={r.check} className="flex items-start gap-3">
              <span
                className={`mt-1 w-2.5 h-2.5 rounded-full shrink-0 ${dotClass}`}
                aria-hidden
              />
              <div className="min-w-0">
                <div className="text-sm font-medium text-gray-900">{r.label}</div>
                <div className="text-[11px] text-gray-600 leading-snug">{r.detail}</div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function RejectForm({ slug }: { slug: string }) {
  const codes = Object.keys(REJECTION_LABELS) as RejectionCode[];
  return (
    <form
      action={`/api/posts/${slug}/reject`}
      method="POST"
      className="rounded-2xl bg-white border border-gray-200 p-5"
    >
      <h3 className="text-[10px] font-semibold tracking-widest uppercase text-indigo-600 mb-3">Reject</h3>
      <label className="block mb-3">
        <span className="text-[10px] font-semibold tracking-widest uppercase text-gray-600">Reason</span>
        <select
          name="reason_code"
          className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-300 bg-white text-sm"
        >
          {codes.map((c) => (
            <option key={c} value={c}>
              {REJECTION_LABELS[c]}
            </option>
          ))}
        </select>
      </label>
      <label className="block mb-3">
        <span className="text-[10px] font-semibold tracking-widest uppercase text-gray-600">Detail (optional, sent to writer regen)</span>
        <textarea
          name="reason_text"
          rows={3}
          className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-300 bg-white text-sm"
        />
      </label>
      <button
        type="submit"
        className="px-4 py-2 rounded-full bg-white border border-gray-400 text-gray-900 font-monotext-[10px] tracking-widest hover:bg-gray-900 hover:text-white transition-colors"
      >
        REJECT
      </button>
      <p className="mt-3 text-[10px] text-gray-600 leading-snug">
        After 2 rejections on the same topic, it's dropped from the queue permanently.
      </p>
    </form>
  );
}

function RejectionHistory({
  entries,
}: {
  entries: { ts: string; code: string; text: string }[];
}) {
  return (
    <div className="rounded-2xl bg-lavender/40 border border-ocean/15 p-5">
      <h3 className="text-[10px] font-semibold tracking-widest uppercase text-indigo-600 mb-3">Rejection history</h3>
      <ul className="space-y-2 text-xs text-gray-900/80">
        {entries.map((e, i) => (
          <li key={i}>
            <span className="mono">{new Date(e.ts).toLocaleString("en-AU")}</span> —{" "}
            <span className="font-medium">{e.code}</span>
            {e.text && <>: {e.text}</>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function RevisionsPanel({ revisions }: { revisions: PostRevision[] }) {
  return (
    <div className="rounded-2xl bg-white border border-gray-200 p-5">
      <h3 className="text-[10px] font-semibold tracking-widest uppercase text-indigo-600 mb-3">
        Revision history ({revisions.length})
      </h3>
      <p className="text-[11px] text-gray-500 mb-4 leading-snug">
        A snapshot is written before every edit. Newest first. Use these to spot
        when a section got accidentally trimmed or a fact slipped out.
      </p>
      <ul className="space-y-3 text-xs text-gray-900/85">
        {revisions.map((r) => {
          const words = (r.data.content_markdown ?? "").split(/\s+/).filter(Boolean).length;
          return (
            <li key={r.id} className="border-l-2 border-indigo-100 pl-3 py-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-[11px] text-gray-700">
                  {new Date(r.edited_at).toLocaleString("en-AU")}
                </span>
                <span className="text-[10px] font-medium text-gray-500">
                  {words} words
                </span>
                {r.edited_by && (
                  <span className="text-[10px] font-medium text-indigo-600">
                    by {r.edited_by}
                  </span>
                )}
              </div>
              {r.reason && (
                <div className="text-[11px] text-gray-600 mt-0.5">{r.reason}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
