/**
 * View 注册：所有 tab/pop 路由的视图懒加载器。
 *
 * GaubeeOS 应用系统：所有视图通过 `/app/*` 路径注册。
 * 旧路径（/feed, /editor 等）已废弃，不再注册。
 *
 * 加载模型（2026-07-23 改造）：
 * - 全部改为动态 import 工厂（ViewLoader），视图按需加载，不进首屏主 bundle。
 * - 与 manifest 的 activity.view 同源（同一目标文件），保持单一事实源。
 * - AreaOutlet 维护已加载组件缓存，加载后常驻 DOM 保活（编辑器/终端会话不丢）。
 * - 加载期间由 appLoadStore 驱动状态栏顶部进度条。
 */
import { asView } from "$lib/apps/types";

import { registerDeepLinkView, registerPopView, registerTabView } from "./registry";

let registered = false;

/** 注册所有 view loader（幂等，多次调用安全）。 */
export function ensureViewsRegistered(): void {
  if (registered) return;
  registered = true;

  // ===== 系统应用（不可卸载）=====
  // 注意：桌面（/desktop）不经 tab 机制，由 AreaOutlet 作为 shell 级背景层直接渲染。
  // 注意：hiddenFromNav 应用（search/notifications/account/app-store）不注册 tabView，
  // 只注册 popView 或 deepLinkView，避免 AreaOutlet 创建永远隐藏的死代码常驻层。
  registerTabView("/app/articles", () => import("$lib/apps/views/ArticlesView.svelte"));
  registerTabView("/app/shout", () => import("$lib/apps/views/ShoutView.svelte"));
  registerTabView("/app/settings", () => import("./SettingsView.svelte"));
  // 主题应用（自定义 primary 色相 + 桌面背景）
  registerTabView("/app/theme", () => import("$lib/apps/views/ThemeView.svelte"));

  // ===== 可安装应用（默认安装）=====
  // github v3：提升为 main 区 tabView（列表页/详情页导航架构）。
  registerTabView("/app/github", () => import("$lib/apps/views/GithubView.svelte"));
  // terminal 是 hiddenFromNav（DEFAULT_HIDDEN），通过 deep link 进入
  registerDeepLinkView("/app/terminal", () => import("./TerminalView.svelte"));
  // 文件管理应用入口
  registerTabView("/app/files", () => import("./FilesView.svelte"));

  // ===== 可选安装 =====
  registerTabView("/app/writer", () => import("$lib/apps/views/WriterView.svelte"));

  // ===== 深链接 views（main 区非 tab 路径，含 hiddenFromNav 应用的 entry route）=====
  // AreaOutlet 渲染深链接视图时统一传入 { pathname }（见 AreaOutlet.svelte）。
  // ArticleDetailView 声明了 pathname props 并实际使用它；其余视图忽略该 prop。
  // 受 Svelte Component 逆变特性限制，此处用 asView 断言宽放
  // （运行时契约由 AreaOutlet 保证，所有深链接视图都会收到 pathname）。
  registerDeepLinkView(
    "/article",
    asView(() => import("$lib/apps/views/ArticleDetailView.svelte")),
  );
  registerDeepLinkView("/tags", () => import("./TagsView.svelte"));
  // hiddenFromNav 应用的 entry route 走 deep link（不注册 tabView）
  registerDeepLinkView("/app/account", () => import("$lib/apps/views/AccountView.svelte"));
  registerDeepLinkView("/app/store", () => import("$lib/apps/views/AppStoreView.svelte"));
  // 写作应用场景（编辑器、变更），入口 /app/writer 已注册为 tab view。
  registerDeepLinkView("/app/editor", () => import("./EditorView.svelte"));
  registerDeepLinkView("/app/changes", () => import("./ChangesView.svelte"));
  // GithubApp 任意文件编辑（raw 模式，复用 EditorView）：/app/github-edit/{owner}/{repo}/{...path}
  registerDeepLinkView("/app/github-edit", () => import("./EditorView.svelte"));

  // ===== pop views（hiddenFromNav pop 应用，只走浮层）=====
  registerPopView("/app/search", () => import("./SearchView.svelte"));
  registerPopView("/app/notifications", () => import("$lib/apps/views/NotificationsView.svelte"));
}

// 模块加载时立即注册
ensureViewsRegistered();
