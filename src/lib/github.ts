import { str_to_base64_binary } from "@gaubee/util";
import { Octokit } from "@octokit/rest";
import type { StagedChange } from "./db";

const GITHUB_TOKEN_KEY = "github_token";

let octokitInstance: Octokit | null = null;

// This function allows tests to inject a mock instance.
export function __setOctokitInstance(instance: Octokit | null) {
  octokitInstance = instance;
}

function getOctokit(tokenOverride?: string) {
  if (octokitInstance) {
    return octokitInstance;
  }

  const token =
    tokenOverride ||
    (typeof window !== "undefined"
      ? localStorage.getItem(GITHUB_TOKEN_KEY)
      : null);
  if (!token) {
    console.warn("GitHub token not found.");
    return null;
  }

  return new Octokit({ auth: token });
}

export async function validateToken(token: string) {
  const octokit = getOctokit(token);
  if (!octokit) return false;
  try {
    await octokit.users.getAuthenticated();
    return true;
  } catch (error) {
    console.error("Token validation failed:", error);
    return false;
  }
}

const OWNER = "gaubee";
const REPO = "gaubee.com";

export async function getFileContent(path: string): Promise<string> {
  const octokit = getOctokit();
  if (!octokit) {
    throw new Error("GitHub client not initialized. Is the token set?");
  }

  try {
    const response = await octokit.repos.getContent({
      owner: OWNER,
      repo: REPO,
      path,
    });
    debugger;
    if (
      "type" in response.data &&
      response.data.type == "file" &&
      response.data.encoding === "base64"
    ) {
      const encoded = response.data.content;
      const buff = str_to_base64_binary(encoded);
      const decoder = new TextDecoder("utf-8");
      return decoder.decode(buff);
    } else {
      throw new Error(
        `Could not get content for path: ${path}. Unexpected encoding.`,
      );
    }
  } catch (error) {
    console.error(`Error fetching file content for path "${path}":`, error);
    throw error;
  }
}

export async function getRepoContents(path: string = "") {
  const octokit = getOctokit();
  if (!octokit) {
    return [];
  }

  try {
    const response = await octokit.repos.getContent({
      owner: OWNER,
      repo: REPO,
      path,
    });

    if (Array.isArray(response.data)) {
      return response.data;
    }
    return [];
  } catch (error) {
    console.error(`Error fetching repo contents for path "${path}":`, error);
    return [];
  }
}

export async function commitChanges(
  message: string,
  changes: StagedChange[],
  branch: string = "main",
) {
  const octokit = getOctokit();
  if (!octokit) {
    throw new Error("GitHub client not initialized.");
  }

  const { data: refData } = await octokit.git.getRef({
    owner: OWNER,
    repo: REPO,
    ref: `heads/${branch}`,
  });
  const latestCommitSha = refData.object.sha;

  const { data: commitData } = await octokit.git.getCommit({
    owner: OWNER,
    repo: REPO,
    commit_sha: latestCommitSha,
  });
  const baseTreeSha = commitData.tree.sha;

  const blobCreationPromises = changes
    .filter(
      (change) => change.status === "created" || change.status === "updated",
    )
    .map(async (change) => {
      const { data: blobData } = await octokit.git.createBlob({
        owner: OWNER,
        repo: REPO,
        content: change.content!,
        encoding: "utf-8",
      });
      return {
        path: change.path,
        sha: blobData.sha,
        mode: "100644" as const,
        type: "blob" as const,
      };
    });

  const createdOrUpdatedBlobs = await Promise.all(blobCreationPromises);

  const deletedFiles = changes
    .filter((change) => change.status === "deleted")
    .map((change) => ({
      path: change.path,
      sha: null,
      mode: "100644" as const,
      type: "blob" as const,
    }));

  const { data: newTree } = await octokit.git.createTree({
    owner: OWNER,
    repo: REPO,
    base_tree: baseTreeSha,
    tree: [...createdOrUpdatedBlobs, ...deletedFiles],
  });

  const { data: newCommit } = await octokit.git.createCommit({
    owner: OWNER,
    repo: REPO,
    message,
    tree: newTree.sha,
    parents: [latestCommitSha],
  });

  await octokit.git.updateRef({
    owner: OWNER,
    repo: REPO,
    ref: `heads/${branch}`,
    sha: newCommit.sha,
  });

  return newCommit;
}
