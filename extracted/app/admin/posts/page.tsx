import Link from "next/link";
import { redirect } from "next/navigation";
import { isAuthorised } from "@/lib/admin/auth";
import { getAllPostFiles, getPendingPostFiles } from "@/lib/admin/loader";
import { runValidators, isApprovable } from "@/lib/admin/validators";
import {
  CONTENT_TYPE_LABELS,
  PILLAR_LABELS,
  type PostFile,
} from "@/lib/admin/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function PostsQueue() {
  if (!(await isAuthorised())) redirect("/admin/login");

  const [pending, all] = await Promise.all([
    getPendingPostFiles(),
    getAllPostFiles(),
  ]);
  const published = all.filter((f) => f.post.status === "published");
  const rejected = all.filter((f) => f.post.status === "rejected");

  return (
    <main className="min-h-[calc(100vh-3.5rem)] pt-10 pb-32 px-6">
      <div className="max-w-[1100px] mx-auto">
        <div className="eyebrow text-ocean mb-3">Editorial admin</div>
        <h1 className="display text-4xl md:text-5xl mb-2">Posts review queue</h1>
        <p className="text-muted text-sm mb-8">
          <span className="font-medium text-ink">{pending.length}</span> pending ·{" "}
          <span>{published.length}</span> published ·{" "}
          <span>{rejected.length}</span> rejected
        </p>

        {pending.length === 0 ? (
          <div className="py-20 text-center rounded-2xl border border-dashed border-ink/15">
            <p className="display text-2xl text-muted italic">
              Nothing to review. Generate a new article with{" "}
              <span className="mono text-sm">python main.py</span>.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {pending.map((file) => (
              <QueueRow key={file.filename} file={file} />
            ))}
          </ul>
        )}

        {published.length > 0 && (
          <details className="mt-12">
            <summary className="cursor-pointer eyebrow text-ocean">
              Recently published ({published.length})
            </summary>
            <ul className="mt-4 space-y-2 text-sm">
              {published.slice(0, 10).map((f) => (
                <li
                  key={f.filename}
                  className="flex items-center justify-between px-4 py-2 rounded-lg bg-white border border-ink/10"
                >
                  <span className="truncate">{f.post.title}</span>
                  <Link
                    href={`/admin/posts/${f.post.slug}`}
                    className="mono text-[10px] tracking-widest text-ocean hover:underline"
                  >
                    VIEW →
                  </Link>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </main>
  );
}

function QueueRow({ file }: { file: PostFile }) {
  const { post } = file;
  const validators = runValidators(post);
  const fails = validators.filter((v) => v.status === "fail").length;
  const warns = validators.filter((v) => v.status === "warn").length;
  const approvable = isApprovable(validators);

  return (
    <li className="flex flex-col md:flex-row md:items-center gap-4 p-4 rounded-2xl bg-white border border-ink/10 hover:border-ocean/40 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-1.5">
          <span className="px-2 py-0.5 rounded bg-electric mono text-[9px] tracking-widest uppercase text-ink">
            {CONTENT_TYPE_LABELS[post.content_type]}
          </span>
          <span className="px-2 py-0.5 rounded bg-lavender mono text-[9px] tracking-widest uppercase text-ocean">
            {PILLAR_LABELS[post.pillar] ?? post.pillar}
          </span>
          <span className="mono text-[10px] text-muted">{post.word_count} words</span>
        </div>
        <h3 className="display text-xl leading-tight">{post.title}</h3>
        <p className="mt-1 text-sm text-muted line-clamp-2">{post.tldr}</p>
        <div className="mt-2 flex items-center gap-3 text-[11px]">
          {fails > 0 ? (
            <span className="text-red-600">{fails} validator fail{fails > 1 ? "s" : ""}</span>
          ) : (
            <span className="text-leaf">All validators green</span>
          )}
          {warns > 0 && <span className="text-muted">· {warns} warning{warns > 1 ? "s" : ""}</span>}
          <span className="text-muted mono">
            · {new Date(post.generated_at).toLocaleString("en-AU")}
          </span>
        </div>
      </div>
      <div className="flex gap-2 shrink-0">
        <Link
          href={`/admin/posts/${post.slug}`}
          className="px-4 py-2 rounded-full bg-ocean text-white mono text-[10px] tracking-widest hover:bg-ink transition-colors"
        >
          REVIEW
        </Link>
        {approvable && (
          <form action={`/api/posts/${post.slug}/approve`} method="POST">
            <button
              type="submit"
              className="px-4 py-2 rounded-full bg-electric text-ink mono text-[10px] tracking-widest hover:bg-ink hover:text-white transition-colors"
            >
              QUICK APPROVE
            </button>
          </form>
        )}
      </div>
    </li>
  );
}
