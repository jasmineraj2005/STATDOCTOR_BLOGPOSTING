import "server-only";

import { promises as fs } from "fs";
import path from "path";
import type { Post, PostFile } from "./types";

// Convention from the existing extracted/lib/posts-server.ts: the Next.js app
// runs from extracted/, and backend/ is one directory up.
const OUTPUT_DIR = path.resolve(process.cwd(), "..", "backend", "output");

/** Listing cache — invalidated when the directory mtime changes. */
let cache: { mtime: number; files: PostFile[] } | null = null;

async function listDir(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir);
  } catch {
    return [];
  }
}

function parseFilename(name: string): { ts: string; slug: string } | null {
  // 20260411_131738_<slug>.json
  const m = name.match(/^(\d{8}_\d{6})_(.+)\.json$/);
  if (!m) return null;
  return { ts: m[1], slug: m[2] };
}

async function readJsonSafe(filepath: string): Promise<Post | null> {
  try {
    const buf = await fs.readFile(filepath, "utf-8");
    const data = JSON.parse(buf);
    // Tolerate missing new fields on legacy JSONs.
    if (!data.status) data.status = "pending_review";
    if (!data.content_type) {
      data.content_type =
        data.pillar === "industry_news"
          ? "news"
          : data.pillar === "company_pov"
            ? "company"
            : "guide";
    }
    if (!data.dateModified) data.dateModified = data.generated_at;
    if (!Array.isArray(data.rejection_history)) data.rejection_history = [];
    if (!Array.isArray(data.keywords)) data.keywords = [];
    return data as Post;
  } catch {
    return null;
  }
}

/** Read every JSON file from backend/output/, sorted newest-first, latest per slug only. */
export async function getAllPostFiles(): Promise<PostFile[]> {
  let stat: { mtimeMs: number };
  try {
    stat = await fs.stat(OUTPUT_DIR);
  } catch {
    return [];
  }
  if (cache && cache.mtime === stat.mtimeMs) {
    return cache.files;
  }

  const names = await listDir(OUTPUT_DIR);
  // Read every JSON, group by the JSON's canonical slug (the filename slug is
  // truncated at 50 chars by the pipeline — never use it for routing).
  type Candidate = { ts: string; filename: string; post: Post };
  const candidates: Candidate[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    if (name === "used_images.json") continue;
    const parsed = parseFilename(name);
    if (!parsed) continue;
    const filepath = path.join(OUTPUT_DIR, name);
    const post = await readJsonSafe(filepath);
    if (!post) continue;
    candidates.push({ ts: parsed.ts, filename: name, post });
  }

  // Keep only the newest timestamp per canonical slug.
  const latestBySlug = new Map<string, Candidate>();
  for (const c of candidates) {
    const existing = latestBySlug.get(c.post.slug);
    if (!existing || c.ts > existing.ts) {
      latestBySlug.set(c.post.slug, c);
    }
  }

  const files: PostFile[] = [];
  for (const [, c] of latestBySlug) {
    files.push({
      filename: c.filename,
      filepath: path.join(OUTPUT_DIR, c.filename),
      ts: c.ts,
      post: c.post,
    });
  }

  files.sort((a, b) => (a.ts < b.ts ? 1 : -1));
  cache = { mtime: stat.mtimeMs, files };
  return files;
}

export async function getPendingPostFiles(): Promise<PostFile[]> {
  const all = await getAllPostFiles();
  return all.filter((f) => f.post.status === "pending_review");
}

export async function getPostFileBySlug(slug: string): Promise<PostFile | null> {
  const all = await getAllPostFiles();
  return all.find((f) => f.post.slug === slug) ?? null;
}

/** Write the post back to its file. Invalidates the cache. */
export async function writePostFile(file: PostFile, post: Post): Promise<void> {
  await fs.writeFile(file.filepath, JSON.stringify(post, null, 2));
  cache = null;
}
