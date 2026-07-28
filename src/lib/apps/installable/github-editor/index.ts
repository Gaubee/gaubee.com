/**
 * GithubEditor 应用（默认安装，可卸载）。
 *
 * 2026-07-28：从 WriterApp 的 github-edit activity 演进为独立应用。
 * 完整的仓库编辑器：首页（收藏/链接输入/最近打开）+ 编辑工作区（文件树 + CodeMirror + 变更 diff + 上传）。
 *
 * 与 GithubApp 的分工：
 * - GithubApp：只读浏览（文件树/历史/Issues），点编辑跳转到这里
 * - GithubEditor：读写编辑（双文件夹 VFS + diff + commit + 上传）
 *
 * 与 WriterApp 的分工：
 * - WriterApp：内容写作（frontmatter + 发表，走 vfsStore 单仓库）
 * - GithubEditor：任意仓库编辑（走 EditorVfs 双文件夹，绕过 vfsStore）
 */
import SquarePenIcon from "@lucide/svelte/icons/square-pen";

import type { AppEntry } from "../../types";
import { githubEditorHomeRoute } from "./routes";

export const githubEditorApp: AppEntry = {
  manifest: {
    id: "github-editor",
    name: "Github编辑器",
    icon: SquarePenIcon,
    category: "default",
    defaultArea: "main",
    activities: [
      {
        pattern: "/app/github-editor",
        entry: true,
        root: githubEditorHomeRoute,
      },
    ],
    description: "GitHub 仓库编辑器",
    longDescription:
      "完整的 GitHub 仓库编辑器：首页（收藏/链接输入/最近打开）+ 编辑工作区（VSCode 式文件树 + CodeMirror 多语言编辑 + 变更 diff + 批量提交 + 文件夹上传）。基于双文件夹 VFS（local 未提交 + remote 缓存）实现准确的 working-tree diff。",
    version: "1.0.0",
    author: "Gaubee",
    homepage: "https://github.com/Gaubee/gaubee.com",
  },
};
