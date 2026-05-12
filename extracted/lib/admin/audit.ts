import "server-only";

import { kv } from "@vercel/kv";
import type { Post, RejectionCode } from "./types";

export type AuditEvent = {
  ts: string;
  slug: string;
  action: "approve" | "reject" | "edit" | "publish" | "publish-failed";
  reason_code?: RejectionCode;
  reason_text?: string;
  detail?: string;
};

const KEY_LATEST = "posts:audit:latest";
const KEY_LIST = "posts:audit:list";

export async function logAuditEvent(event: AuditEvent): Promise<void> {
  try {
    await kv.lpush(KEY_LIST, JSON.stringify(event));
    await kv.set(KEY_LATEST, event);
    await kv.ltrim(KEY_LIST, 0, 499); // keep last 500
  } catch {
    // KV unavailable in local dev without env vars — silently skip.
  }
}

export async function getRecentAuditEvents(limit = 50): Promise<AuditEvent[]> {
  try {
    const raw = await kv.lrange<string>(KEY_LIST, 0, limit - 1);
    return raw
      .map((s) => {
        try {
          return JSON.parse(s) as AuditEvent;
        } catch {
          return null;
        }
      })
      .filter((e): e is AuditEvent => e !== null);
  } catch {
    return [];
  }
}

export function summariseRejection(post: Post): string | null {
  const last = post.rejection_history?.[post.rejection_history.length - 1];
  if (!last) return null;
  return `${last.code}${last.text ? ` — ${last.text}` : ""}`;
}
