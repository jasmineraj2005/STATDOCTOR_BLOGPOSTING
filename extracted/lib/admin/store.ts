/**
 * Storage abstraction for the review queue.
 *
 * Modes:
 *  - DB mode  (POSTGRES_URL set):  Postgres is the source of truth.
 *                                  FS still gets a backup JSON write so local-dev tools
 *                                  and `git`-tracked outputs continue to work.
 *  - FS mode  (POSTGRES_URL unset): backend/output/*.json is the only source.
 *
 * Callers never branch — they just use the exported async functions.
 */

import "server-only";

import { promises as fs } from "fs";
import path from "path";
import { sql, isDbConfigured } from "./db";
import {
  getAllPostFiles as fsGetAll,
  getPendingPostFiles as fsGetPending,
  getPostFileBySlug as fsGetBySlug,
  writePostFile as fsWrite,
} from "./loader";
import type { Post, PostFile, PostStatus, RejectionCode } from "./types";

const OUTPUT_DIR = path.resolve(process.cwd(), "..", "backend", "output");

// ──────────────────────────────────────────────────────────────────────────────
// Row ↔ PostFile mapping
// ──────────────────────────────────────────────────────────────────────────────

type Row = {
  slug: string;
  filename: string;
  status: PostStatus;
  pillar: string;
  content_type: string;
  word_count: number;
  ahpra_passed: boolean;
  generated_at: Date | string;
  date_modified: Date | string;
  last_reviewed_at: Date | string | null;
  data: Post;
};

function rowToFile(row: Row): PostFile {
  // The `data` column has the canonical JSON; merge the row-level columns on top
  // so any drift between DB columns and JSON stays consistent (DB columns win).
  const post: Post = {
    ...row.data,
    slug: row.slug,
    status: row.status,
    pillar: row.pillar,
    content_type: row.data.content_type ?? (row.content_type as Post["content_type"]),
    word_count: row.word_count,
    ahpra_passed: row.ahpra_passed,
    generated_at:
      typeof row.generated_at === "string"
        ? row.generated_at
        : row.generated_at.toISOString(),
    dateModified:
      typeof row.date_modified === "string"
        ? row.date_modified
        : row.date_modified.toISOString(),
    last_reviewed_at:
      row.last_reviewed_at == null
        ? null
        : typeof row.last_reviewed_at === "string"
          ? row.last_reviewed_at
          : row.last_reviewed_at.toISOString(),
  };

  const ts = post.generated_at.replace(/[-:T]/g, "").slice(0, 15).replace(/\./, "_");
  return {
    filename: row.filename,
    filepath: path.join(OUTPUT_DIR, row.filename),
    ts,
    post,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Reads
// ──────────────────────────────────────────────────────────────────────────────

export async function getAllPosts(): Promise<PostFile[]> {
  if (isDbConfigured()) {
    const { rows } = await sql<Row>`
      SELECT slug, filename, status, pillar, content_type, word_count, ahpra_passed,
             generated_at, date_modified, last_reviewed_at, data
        FROM posts
        ORDER BY generated_at DESC
    `;
    return rows.map(rowToFile);
  }
  return fsGetAll();
}

export async function getPendingPosts(): Promise<PostFile[]> {
  if (isDbConfigured()) {
    const { rows } = await sql<Row>`
      SELECT slug, filename, status, pillar, content_type, word_count, ahpra_passed,
             generated_at, date_modified, last_reviewed_at, data
        FROM posts
        WHERE status = 'pending_review'
        ORDER BY generated_at DESC
    `;
    return rows.map(rowToFile);
  }
  return fsGetPending();
}

export async function getPostBySlug(slug: string): Promise<PostFile | null> {
  if (isDbConfigured()) {
    const { rows } = await sql<Row>`
      SELECT slug, filename, status, pillar, content_type, word_count, ahpra_passed,
             generated_at, date_modified, last_reviewed_at, data
        FROM posts WHERE slug = ${slug}
    `;
    return rows.length ? rowToFile(rows[0]) : null;
  }
  return fsGetBySlug(slug);
}

/**
 * Atomically transition a post from 'pending_review' → 'scheduled'.
 *
 * Uses a single SQL UPDATE … WHERE status='pending_review' RETURNING so that
 * Postgres's row-level locking guarantees only one concurrent caller gets the
 * row back. The second concurrent caller sees rowCount=0 and returns null.
 *
 * Returns the updated PostFile if the row was claimed, null if the post did not
 * exist OR was already claimed (status ≠ 'pending_review').
 *
 * FS-only mode: throws — this operation cannot be made atomic on the filesystem.
 */
export async function claimForApproval(slug: string): Promise<PostFile | null> {
  if (!isDbConfigured()) {
    throw new Error("claimForApproval requires DB; cannot run in fs-only mode");
  }
  const now = new Date().toISOString();
  const { rows } = await sql<Row>`
    UPDATE posts
       SET status           = 'scheduled',
           last_reviewed_at = ${now},
           date_modified    = ${now},
           data             = jsonb_set(
                                jsonb_set(data, '{status}', '"scheduled"'),
                                '{last_reviewed_at}', to_jsonb(${now}::text)
                              )
     WHERE slug   = ${slug}
       AND status = 'pending_review'
     RETURNING slug, filename, status, pillar, content_type, word_count, ahpra_passed,
               generated_at, date_modified, last_reviewed_at, data
  `;
  return rows.length ? rowToFile(rows[0]) : null;
}

// ──────────────────────────────────────────────────────────────────────────────
// Writes
// ──────────────────────────────────────────────────────────────────────────────

/** Insert or update a full post record. Used by the Python pipeline (via the
 *  /api/admin/ingest endpoint) and by the edit handler. */
export async function upsertPost(file: PostFile, post: Post): Promise<void> {
  if (isDbConfigured()) {
    const data = JSON.stringify(post);
    await sql`
      INSERT INTO posts (
        slug, filename, status, pillar, content_type, word_count, ahpra_passed,
        generated_at, date_modified, last_reviewed_at, data
      ) VALUES (
        ${post.slug},
        ${file.filename},
        ${post.status},
        ${post.pillar},
        ${post.content_type},
        ${post.word_count},
        ${post.ahpra_passed},
        ${post.generated_at},
        ${post.dateModified ?? post.generated_at},
        ${post.last_reviewed_at ?? null},
        ${data}::jsonb
      )
      ON CONFLICT (slug) DO UPDATE SET
        filename         = EXCLUDED.filename,
        status           = EXCLUDED.status,
        pillar           = EXCLUDED.pillar,
        content_type     = EXCLUDED.content_type,
        word_count       = EXCLUDED.word_count,
        ahpra_passed     = EXCLUDED.ahpra_passed,
        generated_at     = EXCLUDED.generated_at,
        date_modified    = EXCLUDED.date_modified,
        last_reviewed_at = EXCLUDED.last_reviewed_at,
        data             = EXCLUDED.data
    `;
  }
  // Dual-write to FS for local backup and git-friendly diffs.
  try {
    await fsWrite(file, post);
  } catch {
    // FS write failure isn't fatal in DB mode; the row is the source of truth.
    if (!isDbConfigured()) throw new Error("Both DB and FS unavailable for write");
  }
}

/** Update a subset of fields. Bypasses the data column's authority for the
 *  given fields so a status flip doesn't require sending the full markdown. */
export async function updateStatus(
  slug: string,
  patch: {
    status?: PostStatus;
    dateModified?: string;
    last_reviewed_at?: string | null;
    word_count?: number;
    meta_title?: string;
    meta_description?: string;
    keywords?: string[];
    content_markdown?: string;
    rejection_history?: unknown;
  },
): Promise<void> {
  const file = await getPostBySlug(slug);
  if (!file) throw new Error(`Post not found: ${slug}`);
  const next: Post = {
    ...file.post,
    ...(patch.status ? { status: patch.status } : {}),
    ...(patch.dateModified ? { dateModified: patch.dateModified } : {}),
    ...(patch.last_reviewed_at !== undefined
      ? { last_reviewed_at: patch.last_reviewed_at }
      : {}),
    ...(patch.word_count !== undefined ? { word_count: patch.word_count } : {}),
    ...(patch.meta_title !== undefined ? { meta_title: patch.meta_title } : {}),
    ...(patch.meta_description !== undefined
      ? { meta_description: patch.meta_description }
      : {}),
    ...(patch.keywords !== undefined ? { keywords: patch.keywords } : {}),
    ...(patch.content_markdown !== undefined
      ? { content_markdown: patch.content_markdown }
      : {}),
    ...(patch.rejection_history !== undefined
      ? { rejection_history: patch.rejection_history as Post["rejection_history"] }
      : {}),
  };
  await upsertPost(file, next);
}

// ──────────────────────────────────────────────────────────────────────────────
// Audit log
// ──────────────────────────────────────────────────────────────────────────────

export type AuditEvent = {
  ts?: string;
  slug: string;
  action: "approve" | "reject" | "edit" | "publish" | "publish-failed";
  reason_code?: RejectionCode;
  reason_text?: string;
  detail?: string;
};

export async function logAudit(event: AuditEvent): Promise<void> {
  if (isDbConfigured()) {
    await sql`
      INSERT INTO audit_events (ts, slug, action, reason_code, reason_text, detail)
      VALUES (
        ${event.ts ?? new Date().toISOString()},
        ${event.slug},
        ${event.action},
        ${event.reason_code ?? null},
        ${event.reason_text ?? null},
        ${event.detail ?? null}
      )
    `;
    return;
  }
  // FS mode: skip (or log to stderr). The KV-based audit in lib/admin/audit.ts
  // is still available for any caller that needs KV specifically.
}
