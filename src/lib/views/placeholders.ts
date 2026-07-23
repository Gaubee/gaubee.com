/**
 * View 注册：所有 tab/pop 路由的视图组件。
 *
 * GaubeeOS 应用系统：所有视图通过 `/app/*` 路径注册。
 * 旧路径（/feed, /editor 等）已废弃，不再注册。
 */
import type { Component } from "svelte";
import ArticleView from "$lib/apps/views/ArticleDetailView.svelte";
import ChangesView from "./ChangesView.svelte";
import EditorView from "./EditorView.svelte";
import FilesView from "./FilesView.svelte";
import SearchView from "./SearchView.svelte";
import SettingsView from "./SettingsView.svelte";
import TagsView from "./TagsView.svelte";
import TerminalView from "./TerminalView.svelte";
import AccountView from "$lib/apps/views/AccountView.svelte";
import ArticlesView from "$lib/apps/views/ArticlesView.svelte";
import ShoutView from "$lib/apps/views/ShoutView.svelte";
import WriterView from "$lib/apps/views/WriterView.svelte";
import GithubView from "$lib/apps/views/GithubView.svelte";
import NotificationsView from "$lib/apps/views/NotificationsView.svelte";
import {
  registerDeepLinkView,
  registerPopView,
  registerTabView,
} from "./registry";

let registered = false;

/** 注册所有 view（幂等，多次调用安全）。 */
export function ensureViewsRegistered(): void {
  if (registered) return;
  registered = true;

  // ===== 系统应用（不可卸载）=====
  registerTabView("/app/articles", ArticlesView);
  registerTabView("/app/shout", ShoutView);
  registerTabView("/app/search", SearchView);
  registerTabView("/app/settings", SettingsView);
  registerTabView("/app/notifications", NotificationsView);

  // ===== 可安装应用（默认安装）=====
  registerTabView("/app/github", GithubView);
  registerTabView("/app/terminal", TerminalView);
  // 文件管理应用入口
  registerTabView("/app/files", FilesView);

  // ===== 可选安装 =====
  registerTabView("/app/writer", WriterView);

  // ===== 深链接 views（main 区非 tab 路径）=====
  // AreaOutlet 渲染深链接视图时统一传入 { pathname }（见 AreaOutlet.svelte）。
  // ArticleView 声明了 pathname props 并实际使用它；其余视图忽略该 prop。
  // 受 Svelte Component 逆变特性限制，此处用 as Component 断言绕过类型不兼容
  // （运行时契约由 AreaOutlet 保证，所有深链接视图都会收到 pathname）。
  registerDeepLinkView("/article", ArticleView as unknown as Component);
  registerDeepLinkView("/tags", TagsView);
  registerDeepLinkView("/app/account", AccountView);
  // 写作应用场景（编辑器、变更），入口 /app/writer 已注册为 tab view。
  registerDeepLinkView("/app/editor", EditorView);
  registerDeepLinkView("/app/changes", ChangesView);

  // ===== pop views =====
  registerPopView("/app/search", SearchView);
  registerPopView("/app/notifications", NotificationsView);
}

// 模块加载时立即注册
ensureViewsRegistered();
