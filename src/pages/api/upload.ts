import type { APIRoute } from "astro";
import { Octokit } from "@octokit/rest";

const GITHUB_TOKEN = import.meta.env.GITHUB_TOKEN;
const OWNER = "gaubee";
const REPO = "gaubee.com";

// TODO: Refactor this to create a new branch and a Pull Request instead of committing directly to main.
// This is a safer and more robust approach for production environments.
export const POST: APIRoute = async ({ request }) => {
  if (!GITHUB_TOKEN) {
    return new Response("GitHub token is not configured.", { status: 500 });
  }

  const octokit = new Octokit({ auth: GITHUB_TOKEN });
  const formData = await request.formData();
  const file = formData.get("file") as File;
  const path = formData.get("path") as string; // e.g., assets/article-0023/new-image.png

  if (!file || !path) {
    return new Response("File or path is missing.", { status: 400 });
  }

  try {
    const content = Buffer.from(await file.arrayBuffer()).toString("base64");

    const { data: blobData } = await octokit.git.createBlob({
      owner: OWNER,
      repo: REPO,
      content,
      encoding: "base64",
    });

    const { data: refData } = await octokit.git.getRef({
      owner: OWNER,
      repo: REPO,
      ref: "heads/main",
    });

    const latestCommitSha = refData.object.sha;

    const { data: commitData } = await octokit.git.getCommit({
      owner: OWNER,
      repo: REPO,
      commit_sha: latestCommitSha,
    });

    const baseTreeSha = commitData.tree.sha;

    const { data: newTree } = await octokit.git.createTree({
      owner: OWNER,
      repo: REPO,
      base_tree: baseTreeSha,
      tree: [
        {
          path,
          mode: "100644",
          type: "blob",
          sha: blobData.sha,
        },
      ],
    });

    const { data: newCommit } = await octokit.git.createCommit({
      owner: OWNER,
      repo: REPO,
      message: `feat(assets): upload ${path}`,
      tree: newTree.sha,
      parents: [latestCommitSha],
    });

    await octokit.git.updateRef({
      owner: OWNER,
      repo: REPO,
      ref: "heads/main",
      sha: newCommit.sha,
    });

    return new Response(
      JSON.stringify({ success: true, path: `/${path}` }),
      { status: 200 }
    );
  } catch (error) {
    console.error("Failed to upload file:", error);
    return new Response("Failed to upload file.", { status: 500 });
  }
};