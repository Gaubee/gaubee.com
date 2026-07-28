import { defineRoute } from "$lib/router";
/**
 * GithubEditorApp 路由定义。
 *
 * Route 树：
 *   /app/github-editor（Activity root）
 *     ├─ ""                        → HomeView（收藏 + 链接输入 + 最近打开）
 *     └─ "repo/:owner/:repo"       → EditorWorkspace（编辑/变更 双 tab）
 *
 * 参数契约：
 * - repo/:owner/:repo 的 owner/repo 是非空字符串
 * - repo 的 search 含 tab（编辑/变更）/ ref（分支）/ file（选中文件）/ upload（上传 Dialog 开关）
 */
import { z } from "zod";

/** GithubEditorApp 入口：首页（收藏 + 链接输入 + 最近打开）。 */
export const githubEditorHomeRoute = defineRoute({
  id: "github-editor",
  pattern: "",
  component: () => import("./views/HomeView.svelte"),
  children: [
    /** 编辑工作区（双 tab：编辑/变更）。 */
    defineRoute({
      id: "github-editor.repo",
      pattern: "repo/:owner/:repo",
      params: z.object({
        owner: z.string().min(1),
        repo: z.string().min(1),
      }),
      search: z.object({
        tab: z.enum(["edit", "changes"]).default("edit"),
        ref: z.string().optional(),
        file: z.string().optional(),
        upload: z.coerce.boolean().optional(),
      }),
      component: () => import("./views/EditorWorkspace.svelte"),
    }),
  ],
});
