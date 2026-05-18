import Link from "next/link";
import { redirect } from "next/navigation";
import ShaderBackground from "@/components/shader-background";
import { Banner } from "@/components/admin/banner";
import { isAuthorised } from "@/lib/admin/auth";
import { getAllPosts, getDeletedPosts, getPendingPosts } from "@/lib/admin/store";
import { computeBannerState, type BannerState } from "@/lib/admin/banner";
import { isDbConfigured, pool } from "@/lib/admin/db";
import { runValidators, isApprovable } from "@/lib/admin/validators";
import {
  CONTENT_TYPE_LABELS,
  PILLAR_LABELS,
  type PostFile,
} from "@/lib/admin/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const GLASS_CARD: React.CSSProperties = {
  background: "rgba(255, 255, 255, 0.10)",
  backdropFilter: "blur(20px)",
  WebkitBackdropFilter: "blur(20px)",
  border: "1px solid rgba(255, 255, 255, 0.18)",
};

const GLASS_ROW_LITE: React.CSSProperties = {
  background: "rgba(255, 255, 255, 0.05)",
  backdropFilter: "blur(12px)",
  WebkitBackdropFilter: "blur(12px)",
  border: "1px solid rgba(255, 255, 255, 0.10)",
};

const PILLAR_CHIP: React.CSSProperties = {
  background: "rgba(139, 92, 246, 0.25)",
  color: "#c4b5fd",
  border: "1px solid rgba(139, 92, 246, 0.35)",
};

const TYPE_CHIP: React.CSSProperties = {
  background: "rgba(255, 255, 255, 0.10)",
  color: "rgba(255, 255, 255, 0.85)",
  border: "1px solid rgba(255, 255, 255, 0.20)",
};

export default async function PostsQueue() {
  if (!(await isAuthorised())) redirect("/login");

  const [pending, all, deleted, bannerState] = await Promise.all([
    getPendingPosts(),
    getAllPosts(),
    getDeletedPosts(30),
    isDbConfigured()
      ? computeBannerState(
          {
            query: async (text, values) => {
              const r = await pool().query(text, values as unknown[]);
              return { rows: r.rows };
            },
          },
          new Date(),
        )
      : Promise.resolve({ kind: "none" } as BannerState),
  ]);
  const scheduled = all.filter((f) => f.post.status === "scheduled");
  const published = all.filter((f) => f.post.status === "published");
  const rejected = all.filter((f) => f.post.status === "rejected");
  const healing = all.filter((f) => f.post.status === "pending_heal");
  const healFailed = all.filter((f) => f.post.status === "heal_failed");

  return (
    <ShaderBackground>
      <main className="relative z-10 min-h-screen pt-14 pb-32 px-6">
        <div className="max-w-[1100px] mx-auto">
          <Banner state={bannerState} />
          <div className="text-[10px] font-medium tracking-widest uppercase text-violet-300 mb-3">
            Editorial admin
          </div>
          <h1 className="text-4xl md:text-5xl font-semibold text-white mb-2" style={{ letterSpacing: "-0.02em" }}>
            Posts review queue
          </h1>
          <p className="text-white/60 text-sm mb-8">
            <span className="font-medium text-white">{pending.length}</span> pending ·{" "}
            <span>{scheduled.length}</span> scheduled ·{" "}
            <span>{published.length}</span> published ·{" "}
            <span>{rejected.length}</span> rejected
            {healing.length > 0 && (
              <>
                {" · "}
                <span className="text-amber-300">{healing.length} healing</span>
              </>
            )}
            {healFailed.length > 0 && (
              <>
                {" · "}
                <span className="text-red-300">{healFailed.length} heal-failed</span>
              </>
            )}
          </p>

          {pending.length === 0 ? (
            <div
              className="py-20 text-center rounded-2xl"
              style={{
                background: "rgba(255, 255, 255, 0.06)",
                backdropFilter: "blur(20px)",
                WebkitBackdropFilter: "blur(20px)",
                border: "1px dashed rgba(255, 255, 255, 0.20)",
              }}
            >
              <p className="text-2xl text-white/70 italic font-light">
                Nothing to review.
              </p>
              <p className="text-white/50 text-sm mt-3 font-light">
                Next pipeline run drops articles here on Mon/Wed/Fri/Sat at 14:00 UTC.
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {pending.map((file) => (
                <QueueRow key={file.filename} file={file} />
              ))}
            </ul>
          )}

          {healing.length > 0 && (
            <FoldSection title={`Healing (${healing.length}) — heal workflow running, will refresh as pending_review`}>
              {healing.map((f) => (
                <RowLite
                  key={f.filename}
                  title={f.post.title}
                  slug={f.post.slug}
                  meta={`fired ${new Date(f.post.generated_at).toLocaleString("en-AU")}`}
                />
              ))}
            </FoldSection>
          )}

          {healFailed.length > 0 && (
            <FoldSection title={`Heal failed (${healFailed.length}) — manual edit required`}>
              {healFailed.map((f) => (
                <RowLite
                  key={f.filename}
                  title={f.post.title}
                  slug={f.post.slug}
                  meta="needs manual edit — validators couldn't auto-fix"
                />
              ))}
            </FoldSection>
          )}

          {scheduled.length > 0 && (
            <FoldSection title={`Scheduled (${scheduled.length}) — next publish slot Tue/Wed/Fri/Sun`}>
              {scheduled.map((f) => (
                <RowLite
                  key={f.filename}
                  title={f.post.title}
                  slug={f.post.slug}
                  meta={`approved ${new Date(f.post.last_reviewed_at ?? f.post.generated_at).toLocaleString("en-AU")}`}
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

          {deleted.length > 0 && (
            <FoldSection
              title={`Deleted, last 30 days (${deleted.length}) — restorable`}
            >
              {deleted.map((f) => (
                <DeletedRow
                  key={f.filename}
                  title={f.post.title}
                  slug={f.post.slug}
                  rejectionCode={
                    f.post.rejection_history?.[f.post.rejection_history.length - 1]?.code ?? "—"
                  }
                />
              ))}
            </FoldSection>
          )}
        </div>
      </main>
    </ShaderBackground>
  );
}

function QueueRow({ file }: { file: PostFile }) {
  const { post } = file;
  const validators = runValidators(post);
  const fails = validators.filter((v) => v.status === "fail").length;
  const warns = validators.filter((v) => v.status === "warn").length;
  const approvable = isApprovable(validators);

  return (
    <li
      className="flex flex-col md:flex-row md:items-center gap-4 p-5 rounded-2xl transition-shadow duration-300 hover:shadow-[0_12px_40px_rgba(139,92,246,0.22)]"
      style={GLASS_CARD}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <span
            className="px-2 py-0.5 rounded text-[9px] tracking-widest uppercase font-mono"
            style={TYPE_CHIP}
          >
            {CONTENT_TYPE_LABELS[post.content_type]}
          </span>
          <span
            className="px-2 py-0.5 rounded text-[9px] tracking-widest uppercase font-mono"
            style={PILLAR_CHIP}
          >
            {PILLAR_LABELS[post.pillar] ?? post.pillar}
          </span>
          <span className="font-mono text-[10px] text-white/50">{post.word_count} words</span>
        </div>
        <Link
          href={`/admin/posts/${post.slug}`}
          className="text-xl font-semibold text-white leading-tight hover:text-violet-200 transition-colors"
          style={{ letterSpacing: "-0.015em" }}
        >
          {post.title}
        </Link>
        <p className="mt-1.5 text-sm text-white/60 line-clamp-2 font-light leading-relaxed">{post.tldr}</p>
        <div className="mt-2.5 flex items-center gap-3 text-[11px] font-light">
          {fails > 0 ? (
            <span className="text-red-300">
              {fails} validator fail{fails > 1 ? "s" : ""}
            </span>
          ) : (
            <span className="text-emerald-300">All validators green</span>
          )}
          {warns > 0 && (
            <span className="text-white/50">
              · {warns} warning{warns > 1 ? "s" : ""}
            </span>
          )}
          <span className="text-white/40 font-mono">
            · {new Date(post.generated_at).toLocaleString("en-AU")}
          </span>
        </div>
      </div>
      <div className="flex gap-2 shrink-0">
        <form action={`/api/posts/${post.slug}/approve`} method="POST">
          <button
            type="submit"
            disabled={!approvable}
            className="px-4 py-2 rounded-full bg-violet-500 text-white font-mono text-[10px] tracking-widest hover:bg-violet-400 transition-colors disabled:bg-white/10 disabled:text-white/30 disabled:cursor-not-allowed"
            title={
              approvable
                ? "Schedule for publish (next Tue/Wed/Fri/Sun slot)"
                : "Fix validators on the Edit page first"
            }
          >
            ACCEPT
          </button>
        </form>
        <Link
          href={`/admin/posts/${post.slug}`}
          className="px-4 py-2 rounded-full bg-white/10 border border-white/20 text-white font-mono text-[10px] tracking-widest hover:bg-white/20 transition-colors"
        >
          EDIT
        </Link>
        <form action={`/api/posts/${post.slug}/reject`} method="POST">
          <input type="hidden" name="reason_code" value="other" />
          <input
            type="hidden"
            name="reason_text"
            value="Dismissed from queue row."
          />
          <button
            type="submit"
            className="px-4 py-2 rounded-full bg-white/5 border border-white/15 text-white/80 font-mono text-[10px] tracking-widest hover:bg-red-500/30 hover:border-red-400/40 hover:text-white transition-colors"
          >
            DISMISS
          </button>
        </form>
      </div>
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
    <details className="mt-12 group">
      <summary className="cursor-pointer text-[10px] font-medium tracking-widest uppercase text-violet-300 hover:text-violet-200 transition-colors">
        {title}
      </summary>
      <ul className="mt-4 space-y-2 text-sm">{children}</ul>
    </details>
  );
}

function RowLite({
  title,
  slug,
  meta,
}: {
  title: string;
  slug: string;
  meta: string;
}) {
  return (
    <li
      className="flex items-center justify-between px-4 py-2.5 rounded-lg transition-colors hover:bg-white/[0.08]"
      style={GLASS_ROW_LITE}
    >
      <Link
        href={`/admin/posts/${slug}`}
        className="truncate text-white/85 hover:text-violet-200 transition-colors"
      >
        {title}
      </Link>
      <span className="font-mono text-[10px] text-white/45">{meta}</span>
    </li>
  );
}

function DeletedRow({
  title,
  slug,
  rejectionCode,
}: {
  title: string;
  slug: string;
  rejectionCode: string;
}) {
  return (
    <li
      className="flex items-center justify-between px-4 py-2.5 rounded-lg transition-colors hover:bg-white/[0.08]"
      style={GLASS_ROW_LITE}
    >
      <div className="flex-1 min-w-0">
        <span className="truncate text-white/60 italic">{title}</span>
        <span className="ml-2 font-mono text-[10px] text-white/35">
          dismissed · {rejectionCode}
        </span>
      </div>
      <form action={`/api/posts/${slug}/restore`} method="POST">
        <button
          type="submit"
          className="px-3 py-1.5 rounded-full bg-white/10 border border-white/20 text-white/85 font-mono text-[10px] tracking-widest hover:bg-violet-500/30 hover:border-violet-400/40 transition-colors"
          title="Restore: clear deleted_at so the post returns to the queue at its previous status."
        >
          RESTORE
        </button>
      </form>
    </li>
  );
}
