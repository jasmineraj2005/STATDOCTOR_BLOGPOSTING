import Link from "next/link";
import { redirect } from "next/navigation";
import { isAuthorised } from "@/lib/admin/auth";
import { getAllPosts, getPendingPosts } from "@/lib/admin/store";
import { runValidators, isApprovable } from "@/lib/admin/validators";
import {
  CONTENT_TYPE_LABELS,
  PILLAR_LABELS,
  type PostFile,
} from "@/lib/admin/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function PostsQueue() {
  if (!(await isAuthorised())) redirect("/login");

  const [pending, all] = await Promise.all([
    getPendingPosts(),
    getAllPosts(),
  ]);
  const scheduled = all.filter((f) => f.post.status === "scheduled");
  const published = all.filter((f) => f.post.status === "published");
  const rejected = all.filter((f) => f.post.status === "rejected");

  return (
    <main className="min-h-[calc(100vh-3.5rem)] bg-ink text-white pt-10 pb-32 px-6">
      <div className="max-w-[1200px] mx-auto">
        <div className="eyebrow text-electric mb-3">Editorial · Sunday review</div>
        <h1 className="display text-4xl md:text-5xl mb-2 text-white">Posts to review</h1>
        <p className="text-white/60 text-sm mb-10">
          <span className="font-medium text-white">{pending.length}</span> pending ·{" "}
          <span>{scheduled.length}</span> scheduled ·{" "}
          <span>{published.length}</span> published ·{" "}
          <span>{rejected.length}</span> rejected
        </p>

        {pending.length === 0 ? (
          <div className="py-20 text-center rounded-2xl border border-dashed border-white/15">
            <p className="display text-2xl text-white/50 italic">
              Nothing to review right now.
            </p>
            <p className="text-white/40 text-sm mt-3">
              Next pipeline run drops articles here on Mon/Wed/Fri/Sat at 14:00 UTC.
            </p>
          </div>
        ) : (
          <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {pending.map((file) => (
              <QueueCard key={file.filename} file={file} />
            ))}
          </ul>
        )}

        {scheduled.length > 0 && (
          <FoldSection title={`Scheduled (${scheduled.length}) — next publish slot`}>
            {scheduled.map((f) => (
              <RowLite
                key={f.filename}
                title={f.post.title}
                slug={f.post.slug}
                meta={`Tue/Wed/Fri/Sun 09:00 UTC`}
              />
            ))}
          </FoldSection>
        )}

        {published.length > 0 && (
          <FoldSection title={`Recently published (${published.length})`}>
            {published.slice(0, 10).map((f) => (
              <RowLite
                key={f.filename}
                title={f.post.title}
                slug={f.post.slug}
                meta={new Date(f.post.dateModified ?? f.post.generated_at).toLocaleString("en-AU")}
              />
            ))}
          </FoldSection>
        )}

        {rejected.length > 0 && (
          <FoldSection title={`Rejected (${rejected.length})`}>
            {rejected.slice(0, 10).map((f) => (
              <RowLite
                key={f.filename}
                title={f.post.title}
                slug={f.post.slug}
                meta={f.post.rejection_history?.[f.post.rejection_history.length - 1]?.code ?? "—"}
              />
            ))}
          </FoldSection>
        )}
      </div>
    </main>
  );
}

function QueueCard({ file }: { file: PostFile }) {
  const { post } = file;
  const validators = runValidators(post);
  const fails = validators.filter((v) => v.status === "fail").length;
  const warns = validators.filter((v) => v.status === "warn").length;
  const approvable = isApprovable(validators);

  // First publisher cited becomes the source byline on the card.
  const sourcePublisher = post.sources?.[0]?.publisher ?? "StatDoctor Pipeline";

  return (
    <li className="flex flex-col rounded-2xl bg-ink/60 border border-white/10 p-6 hover:border-electric/60 transition-colors">
      {/* Eyebrow chip row — content type · pillar */}
      <div className="eyebrow text-electric mb-3">
        {CONTENT_TYPE_LABELS[post.content_type]} <span className="opacity-40">·</span>{" "}
        {PILLAR_LABELS[post.pillar] ?? post.pillar}
      </div>

      {/* Title */}
      <Link
        href={`/admin/posts/${post.slug}`}
        className="display text-xl md:text-2xl leading-tight text-white hover:text-electric transition-colors mb-3"
      >
        {post.title}
      </Link>

      {/* TL;DR / description */}
      <p className="text-sm text-white/70 leading-relaxed line-clamp-5 mb-4 flex-1">
        {post.tldr}
      </p>

      {/* Source line */}
      <div className="mb-5">
        <span className="text-electric text-sm font-medium">{sourcePublisher}</span>
        <span className="text-white/40 text-xs ml-2">
          · {post.word_count} words · {post.reading_time_minutes} min read
        </span>
      </div>

      {/* Validator badge — small, but visible */}
      <div className="mb-4 text-[11px]">
        {fails > 0 ? (
          <span className="text-red-400">
            ⚠ {fails} check{fails > 1 ? "s" : ""} failing — fix before accept
          </span>
        ) : warns > 0 ? (
          <span className="text-electric/80">✓ Ready · {warns} soft warning{warns > 1 ? "s" : ""}</span>
        ) : (
          <span className="text-leaf">✓ All 8 checks pass</span>
        )}
      </div>

      {/* Big buttons — ACCEPT / DISMISS / REVIEW */}
      <div className="grid grid-cols-2 gap-3 mt-auto">
        <form action={`/api/posts/${post.slug}/approve`} method="POST">
          <button
            type="submit"
            disabled={!approvable}
            className="w-full py-3 rounded-lg bg-white text-ink mono text-[11px] tracking-widest font-semibold hover:bg-electric transition-colors disabled:bg-white/20 disabled:text-white/40 disabled:cursor-not-allowed"
            title={
              approvable
                ? "Schedule for publish (next Tue/Wed/Fri/Sun slot)"
                : "Fix validators on the Review page first"
            }
          >
            ACCEPT
          </button>
        </form>
        <form action={`/api/posts/${post.slug}/reject`} method="POST">
          <input type="hidden" name="reason_code" value="other" />
          <input
            type="hidden"
            name="reason_text"
            value="Dismissed from queue card."
          />
          <button
            type="submit"
            className="w-full py-3 rounded-lg bg-transparent border border-white/30 text-white mono text-[11px] tracking-widest font-semibold hover:bg-white/10 transition-colors"
          >
            DISMISS
          </button>
        </form>
      </div>

      {/* Tertiary review link */}
      <Link
        href={`/admin/posts/${post.slug}`}
        className="mt-3 text-center text-[11px] text-white/40 hover:text-electric mono tracking-widest"
      >
        REVIEW IN DETAIL →
      </Link>
    </li>
  );
}

function FoldSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <details className="mt-12">
      <summary className="cursor-pointer eyebrow text-electric/80 mb-3">
        {title}
      </summary>
      <ul className="mt-4 space-y-2 text-sm">{children}</ul>
    </details>
  );
}

function RowLite({ title, slug, meta }: { title: string; slug: string; meta: string }) {
  return (
    <li className="flex items-center justify-between px-4 py-2 rounded-lg bg-white/5 border border-white/10">
      <Link
        href={`/admin/posts/${slug}`}
        className="truncate text-white/80 hover:text-electric"
      >
        {title}
      </Link>
      <span className="mono text-[10px] text-white/40">{meta}</span>
    </li>
  );
}
