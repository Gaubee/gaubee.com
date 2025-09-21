import { Octokit } from '@octokit/rest';
import type { StagedChange } from './db';

const GITHUB_TOKEN_KEY = 'github_token';

function getOctokit() {
  const token = typeof window !== 'undefined' ? localStorage.getItem(GITHUB_TOKEN_KEY) : null;
  if (!token) {
    // We can't throw an error here directly because this might be called on the server
    // where window is not defined. The calling function should handle the null case.
    console.warn('GitHub token not found. Please set it in the admin panel.');
    return null;
  }
  return new Octokit({ auth: token });
}

const OWNER = 'gaubee';
const REPO = 'gaubee.com';

export async function getFileContent(path: string): Promise<string> {
  const octokit = getOctokit();
  if (!octokit) {
    throw new Error('GitHub client not initialized. Is the token set?');
  }

  try {
    const response = await octokit.repos.getContent({
      owner: OWNER,
      repo: REPO,
      path,
    });

    // Type guard to ensure we have a file object with content
    if ('content' in response.data && 'encoding' in response.data && response.data.encoding === 'base64') {
      // Decode from base64. Handle browser and Node.js environments.
      if (typeof window !== 'undefined') {
        return window.atob(response.data.content);
      } else {
        return Buffer.from(response.data.content, 'base64').toString('utf-8');
      }
    } else {
      throw new Error(`Could not get content for path: ${path}. Response was not a file or had unexpected encoding.`);
    }
  } catch (error) {
    console.error(`Error fetching file content for path "${path}":`, error);
    throw error; // Re-throw to be handled by the caller
  }
}

export async function getRepoContents(path: string = '') {
  const octokit = getOctokit();
  if (!octokit) {
    return []; // Return empty array if octokit is not initialized
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
    // Potentially handle different types of errors, e.g., 404 Not Found
    return [];
  }
}

export async function commitChanges(message: string, changes: StagedChange[], branch: string = 'main') {
  const octokit = getOctokit();
  if (!octokit) {
    throw new Error('GitHub client not initialized.');
  }

  // 1. Get the latest commit SHA of the branch
  const { data: refData } = await octokit.git.getRef({
    owner: OWNER,
    repo: REPO,
    ref: `heads/${branch}`,
  });
  const latestCommitSha = refData.object.sha;

  // 2. Get the tree of the latest commit
  const { data: commitData } = await octokit.git.getCommit({
    owner: OWNER,
    repo: REPO,
    commit_sha: latestCommitSha,
  });
  const baseTreeSha = commitData.tree.sha;

  // 3. Create blobs for new/updated files
  const blobCreationPromises = changes
    .filter(change => change.status === 'created' || change.status === 'updated')
    .map(async (change) => {
      const { data: blobData } = await octokit.git.createBlob({
        owner: OWNER,
        repo: REPO,
        content: change.content!,
        encoding: 'utf-8',
      });
      return {
        path: change.path,
        sha: blobData.sha,
        mode: '100644' as const, // file mode
        type: 'blob' as const,
      };
    });

  const createdOrUpdatedBlobs = await Promise.all(blobCreationPromises);

  // 4. Create the tree object for deleted files
  const deletedFiles = changes
    .filter(change => change.status === 'deleted')
    .map(change => ({
      path: change.path,
      sha: null, // Deleting a file is done by setting its SHA to null
      mode: '100644' as const,
      type: 'blob' as const,
    }));

  // 5. Create a new tree
  const { data: newTree } = await octokit.git.createTree({
    owner: OWNER,
    repo: REPO,
    base_tree: baseTreeSha,
    tree: [...createdOrUpdatedBlobs, ...deletedFiles],
  });

  // 6. Create a new commit
  const { data: newCommit } = await octokit.git.createCommit({
    owner: OWNER,
    repo: REPO,
    message,
    tree: newTree.sha,
    parents: [latestCommitSha],
  });

  // 7. Update the branch reference (push)
  await octokit.git.updateRef({
    owner: OWNER,
    repo: REPO,
    ref: `heads/${branch}`,
    sha: newCommit.sha,
  });

  return newCommit;
}
