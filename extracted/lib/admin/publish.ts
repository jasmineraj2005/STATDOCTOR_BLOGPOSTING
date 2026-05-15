import "server-only";

import { promises as fs } from "fs";
import path from "path";
import type { PostFile } from "./types";

export type PublishMode = "local-fs" | "github" | "none";
export type PublishResult = {
  mode: PublishMode;
  ok: boolean;
  destination: string;
  detail: string;
};

export type PublishOpts = {
  fetcher?: typeof fetch;
  sleeper?: (ms: number) => Promise<void>;
  maxRetries?: number;
};

function safeFilename(file: PostFile): string {
  // Reuse the existing filename — preserves timestamp + slug ordering on the website.
  return file.filename;
}

/** Serialise the post for committing/copying — never re-reads from disk so this
 *  works in DB-only mode (no JSON files present in the Vercel container). */
function serialise(file: PostFile): string {
  return JSON.stringify(file.post, null, 2);
}

async function publishToFs(file: PostFile, targetDir: string): Promise<PublishResult> {
  const dst = path.join(targetDir, safeFilename(file));
  try {
    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(dst, serialise(file));
    return {
      mode: "local-fs",
      ok: true,
      destination: dst,
      detail: `Wrote ${dst}.`,
    };
  } catch (e) {
    return {
      mode: "local-fs",
      ok: false,
      destination: dst,
      detail: `fs write failed: ${String(e)}`,
    };
  }
}

export async function publishToGitHub(file: PostFile, opts: PublishOpts = {}): Promise<PublishResult> {
  const fetcher = opts.fetcher ?? fetch;
  const sleeper = opts.sleeper ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const maxRetries = opts.maxRetries ?? 3;

  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.WEBSITE_REPO_OWNER;
  const repo = process.env.WEBSITE_REPO_NAME;
  const branch = process.env.WEBSITE_REPO_BRANCH || "main";
  if (!token || !owner || !repo) {
    return {
      mode: "github",
      ok: false,
      destination: "",
      detail: "GITHUB_TOKEN / WEBSITE_REPO_OWNER / WEBSITE_REPO_NAME not set.",
    };
  }

  const pathInRepo = `content/posts/${safeFilename(file)}`;
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${pathInRepo}`;

  // Read existing JSON so we can include sha if the file already exists.
  let sha: string | undefined;
  const headRes = await fetcher(`${apiUrl}?ref=${branch}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
  });
  if (headRes.ok) {
    const meta = (await headRes.json()) as { sha?: string };
    sha = meta.sha;
  }

  const content = serialise(file);
  const bodyObj = {
    message: `Publish blog post: ${file.post.slug}`,
    content: Buffer.from(content, "utf-8").toString("base64"),
    branch,
    sha,
  };
  const bodyStr = JSON.stringify(bodyObj);
  const putHeaders = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
  };

  const destination = `${owner}/${repo}:${pathInRepo}@${branch}`;

  // Retry loop around the PUT — retries on 5xx, not on 4xx.
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const putRes = await fetcher(apiUrl, {
      method: "PUT",
      headers: putHeaders,
      body: bodyStr,
    });

    if (putRes.ok) {
      return {
        mode: "github",
        ok: true,
        destination,
        detail: `Committed to ${owner}/${repo} on branch ${branch}.`,
      };
    }

    // 422 / 409 = SHA conflict — file already exists with a different SHA.
    // Treat as success: the content is already published.
    if (putRes.status === 422 || putRes.status === 409) {
      return {
        mode: "github",
        ok: true,
        destination,
        detail: `File already exists (HTTP ${putRes.status}); treating as published.`,
      };
    }

    // 5xx — retry with exponential backoff (200ms, 800ms, 3.2s, …).
    if (putRes.status >= 500 && attempt < maxRetries) {
      await sleeper(200 * Math.pow(4, attempt - 1));
      continue;
    }

    // 4xx (other than 409/422) or exhausted retries on 5xx.
    const text = await putRes.text();
    return {
      mode: "github",
      ok: false,
      destination,
      detail: `GitHub PUT ${putRes.status}: ${text.slice(0, 200)}`,
    };
  }

  // Safety return — reached when maxRetries exhausted via 5xx on the last attempt.
  return {
    mode: "github",
    ok: false,
    destination,
    detail: `GitHub PUT failed after ${maxRetries} attempts.`,
  };
}

export async function publishPost(file: PostFile): Promise<PublishResult> {
  const localDir = process.env.WEBSITE_POSTS_DIR;
  const ghToken = process.env.GITHUB_TOKEN;
  if (localDir) return publishToFs(file, localDir);
  if (ghToken) return publishToGitHub(file);
  return {
    mode: "none",
    ok: false,
    destination: "",
    detail:
      "No publish target configured. Set WEBSITE_POSTS_DIR (local) or GITHUB_TOKEN + WEBSITE_REPO_* (prod).",
  };
}
