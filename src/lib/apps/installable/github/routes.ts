import { defineRoute } from "$lib/router";
/**
 * GithubApp 路由定义（2026-07-27 路由重构）。
 *
 * 替代旧 GithubView.svelte 的手工正则分发，改为类型安全的 RouteContract 嵌套树。
 *
 * Route 树：
 *   /app/github（Activity root）
 *     ├─ ""                        → GithubHomeView（聚合卡片列表）
 *     ├─ "list/:type"              → RepoListView（分页列表，复用列表组件）
 *     └─ "repo/:owner/:repo"       → RepoDetailView（详情页 5 Tab）
 *
 * 参数契约：
 * - list/:type 的 type 是字符串（favorites / user:{login} / org:{org}）
 * - repo/:owner/:repo 的 owner/repo 是非空字符串
 * - repo detail 的 search 含 tab/sha/file/issue/ref 等（zod 校验）
 *
 * 删除项：GithubView.svelte（手工正则分发器，被 ActivityRouter + RouteContract 取代）
 */
import { z } from "zod";

/** GithubApp 入口：聚合卡片列表（首页）。 */
export const githubHomeRoute = defineRoute({
  id: "github",
  pattern: "",
  component: () => import("$lib/apps/views/github/RepoListView.svelte"),
  children: [
    /** 分页列表（type=favorites|user:{login}|org:{org}）。复用 RepoListView，传 listFilter。 */
    defineRoute({
      id: "github.list.type",
      pattern: "list/:type",
      params: z.object({ type: z.string().min(1) }),
      component: () => import("$lib/apps/views/github/RepoListView.svelte"),
    }),
    /** 仓库详情页（5 Tab：files/history/changes/issues/log）。 */
    defineRoute({
      id: "github.repo.detail",
      pattern: "repo/:owner/:repo",
      params: z.object({
        owner: z.string().min(1),
        repo: z.string().min(1),
      }),
      search: z.object({
        tab: z.enum(["files", "history", "issues", "log"]).default("files"),
        sha: z.string().optional(),
        file: z.string().optional(),
        issue: z.coerce.number().optional(),
        activity: z.string().optional(),
        ref: z.string().optional(),
      }),
      component: () => import("$lib/apps/views/github/RepoDetailView.svelte"),
    }),
  ],
});
