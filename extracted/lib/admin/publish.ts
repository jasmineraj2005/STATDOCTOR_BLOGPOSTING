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

function safeFilename(file: PostFile): string {
  // Reuse the existing filename — preserves timestamp + slug ordering on the website.
  return file.filename;
}

async function publishToFs(file: PostFile, targetDir: string): Promise<PublishResult> {
  const dst = path.join(targetDir, safeFilename(file));
  try {
    await fs.mkdir(targetDir, { recursive: true });
    await fs.copyFile(file.filepath, dst);
    return {
      mode: "local-fs",
      ok: true,
      destination: dst,
      detail: `Copied to ${dst}.`,
    };
  } catch (e) {
    return {
      mode: "local-fs",
      ok: false,
      destination: dst,
      detail: `fs copy failed: ${String(e)}`,
    };
  }
}

async function publishToGitHub(file: PostFile): Promise<PublishResult> {
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
  const headRes = await fetch(`${apiUrl}?ref=${branch}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
  });
  if (headRes.ok) {
    const meta = (await headRes.json()) as { sha?: string };
    sha = meta.sha;
  }

  const content = await fs.readFile(file.filepath, "utf-8");
  const body = {
    message: `Publish blog post: ${file.post.slug}`,
    content: Buffer.from(content, "utf-8").toString("base64"),
    branch,
    sha,
  };

  const putRes = await fetch(apiUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!putRes.ok) {
    const text = await putRes.text();
    return {
      mode: "github",
      ok: false,
      destination: `${owner}/${repo}:${pathInRepo}@${branch}`,
      detail: `GitHub PUT ${putRes.status}: ${text.slice(0, 200)}`,
    };
  }
  return {
    mode: "github",
    ok: true,
    destination: `${owner}/${repo}:${pathInRepo}@${branch}`,
    detail: `Committed to ${owner}/${repo} on branch ${branch}.`,
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
