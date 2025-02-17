import { Octokit } from "@octokit/rest";

const projectsJsonFilepath = path.resolve(import.meta.dirname, "projects.json");

type RepoContributionCounts = Array<{
  id: number;
  name: string;
  fullName: string;
  url: string;
  description: string;
  firstCommitTime: string;
  lastCommitTime: string;
  commitCount: number;
}>;

const writeProjectsJson = async (
  repoContributionCounts: RepoContributionCounts
) => {
  await writeFile(
    projectsJsonFilepath,
    JSON.stringify(repoContributionCounts, null, 2)
  );
};
export const readProjectsJson = async () => {
  return JSON.parse(
    await readFile(projectsJsonFilepath, "utf-8")
  ) as RepoContributionCounts;
};

/**从github上下载所有的项目信息 */
async function getAllProjects() {
  if (!process.env.GITHUB_TOKEN) {
    throw new Error("GITHUB_TOKEN is not set!");
  }

  const octokit = new Octokit({
    auth: process.env.GITHUB_TOKEN,
  });

  // 1. 获取当前用户信息，以便后续过滤 commit
  const user = await octokit.rest.users.getAuthenticated();
  const username = user.data.login;
  console.log(`Your GitHub username: ${username}`);

  // 2. 获取用户能访问的所有仓库 (保持不变，因为我们需要从这些仓库中筛选)
  type Repos = Awaited<
    ReturnType<typeof octokit.rest.repos.listForAuthenticatedUser>
  >["data"];
  async function getAllRepos(page = 0): Promise<Repos> {
    const per_page = 100;
    const repos = await octokit.paginate(
      octokit.rest.repos.listForAuthenticatedUser,
      {
        affiliation: "owner,collaborator,organization_member", //owner,collaborator,organization_member
        per_page: per_page,
        page,
        sort: "updated",
        direction: "desc",
      }
    );
    return [
      repos,
      repos.length === per_page ? await getAllRepos(page + 1) : [],
    ].flat();
  }

  const repos = await getAllRepos();
  await writeFile(
    path.resolve(import.meta.dirname, "repos.json"),
    JSON.stringify(repos, null, 2)
  );

  const oldRepoContributionCounts = await readProjectsJson();

  const repoContributionCounts: RepoContributionCounts =
    oldRepoContributionCounts.filter((item) => {
      const repo = repos.find((repo) => repo.id === item.id);
      if (repo == null) {
        return false;
      }
      item.id = repo.id;
      item.name = repo.name;
      item.url = repo.html_url;
      item.description = repo.description || "_No description_";
      item.fullName = repo.full_name;
      return true;
    });

  writeProjectsJson(repoContributionCounts);

  console.log("\nRepositories with your commits (sorted by commit count):");

  for (const repo of repos) {
    let userCommitCount = 0;
    let firstCommitTime = repo.created_at!;
    let lastCommitTime = repo.updated_at!;

    try {
      // 3. 获取贡献者统计信息
      const contributorsStats = await octokit.rest.repos.getContributorsStats({
        owner: repo.owner.login,
        repo: repo.name,
      });

      console.log(`${repo.owner.login}/${repo.name}`);
      if (contributorsStats.status === 202) {
        continue;
      }

      if (Array.isArray(contributorsStats.data)) {
        // 4. 查找当前用户的贡献信息
        const userContribution = contributorsStats.data.find(
          (contributor) => contributor.author?.login === username
        );

        if (userContribution) {
          userCommitCount = userContribution.total;
        }
      }
      console.log("userContribution", userCommitCount);

      // 5. 获取首次和最后一次 commit 时间 (仍然需要 commits 接口，只获取用户自己的 commit)
      if (userCommitCount > 0) {
        // 只有当有 commit 时才获取时间
        const commits = await octokit.rest.repos.listCommits({
          owner: repo.owner.login,
          repo: repo.name,
          author: username, // 只获取指定 author 的 commits
          per_page: 1,
        });

        if (commits.data.length > 0) {
          if (commits.data[0].commit.committer?.date) {
            lastCommitTime = new Date(
              commits.data[0].commit.committer.date
            ).toString();
          }
        }
      }
    } catch (error) {
      if (error.status === 403) {
        throw error;
      }
      // 针对 404 错误进行处理，表示可能仓库没有 contributors stats 信息 (例如空仓库)
      if (error.status === 404) {
        console.warn(
          `Contributors stats not found for repo ${repo.full_name}, skipping stats.`
        );
        userCommitCount = 0; // 视为没有贡献
      } else {
        console.error(
          `Error fetching contributor stats for repo ${repo.full_name}:`,
          error
        );
      }
    }

    const index = repoContributionCounts.findIndex((it) => it.id === repo.id);
    if (userCommitCount > 0) {
      const item = {
        id: repo.id,
        name: repo.name,
        fullName: repo.full_name,
        url: repo.html_url,
        description: repo.description || "_No description_",
        firstCommitTime: firstCommitTime,
        lastCommitTime: lastCommitTime,
        commitCount: userCommitCount,
      };
      // 只显示有用户 commit 的仓库
      if (index === -1) {
        repoContributionCounts.push(item);
      } else {
        repoContributionCounts[index] = item;
      }
      await writeProjectsJson(repoContributionCounts);
    } else {
      if (index !== -1) {
        repoContributionCounts.splice(index, 1);
        await writeProjectsJson(repoContributionCounts);
      }
    }
  }

  // 6. 按照 commitCount 降序排序仓库
  repoContributionCounts.sort((a, b) => b.commitCount - a.commitCount);
  await writeProjectsJson(repoContributionCounts);

  return repoContributionCounts;
}

import { import_meta_ponyfill } from "import-meta-ponyfill";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// node --env-file=.env --env-file=.env.local ./vike-app/database/projects.controller.ts
if (import_meta_ponyfill(import.meta).main) {
  (async () => {
    const repoContributionCounts = await getAllProjects().catch((e) => {
      console.error("QAQ", e);
      if (e.status === 403) {
        console.log(
          "限速解锁于：",
          new Date(
            e.response.headers["x-ratelimit-reset"] * 1000
          ).toLocaleString()
        );
      }
      return [];
    });
    for (const repoInfo of repoContributionCounts) {
      console.log(
        `\nRepository Name: ${repoInfo.name} (Commits: ${repoInfo.commitCount})`
      );
      console.log(`URL: ${repoInfo.url}`);
      console.log(`Description: ${repoInfo.description}`);
      console.log(
        `First Commit Time (your commit): ${repoInfo.firstCommitTime}`
      );
      console.log(`Last Commit Time (your commit): ${repoInfo.lastCommitTime}`);
    }
  })();
}
