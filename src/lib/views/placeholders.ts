/**
 * View 注册：所有 tab/pop 路由的视图组件。
 *
 * 阶段 1：注册应用视图（新旧路径双轨运行）。
 * 应用系统注册新路径 `/app/*`，旧路径保留兼容。
 */
import Archive from "./ArchiveView.svelte";
import ArticleView from "./ArticleView.svelte";
import ChangesView from "./ChangesView.svelte";
import EditorView from "./EditorView.svelte";
import FilesView from "./FilesView.svelte";
import FeedView from "./FeedView.svelte";
import GitView from "./GitView.svelte";
import SearchView from "./SearchView.svelte";
import SettingsView from "./SettingsView.svelte";
import TagsView from "./TagsView.svelte";
import TerminalView from "./TerminalView.svelte";
import ShoutView from "$lib/apps/views/ShoutView.svelte";
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

  // ===== 新路径（GaubeeOS 应用路由）=====
  // 系统应用
  registerTabView("/app/articles", FeedView);
  registerTabView("/app/shout", ShoutView);
  registerTabView("/app/search", SearchView);
  registerTabView("/app/settings", SettingsView);
  registerTabView("/app/notifications", NotificationsView);

  // 可安装应用（默认安装）
  registerTabView("/app/github", GitView);
  registerTabView("/app/terminal", TerminalView);

  // 可选安装
  registerTabView("/app/writer", EditorView);

  // ===== 旧路径兼容（保留直到完整迁移）=====
  registerTabView("/feed", FeedView);
  registerTabView("/editor", EditorView);
  registerTabView("/files", FilesView);
  registerTabView("/changes", ChangesView);
  registerTabView("/archive", Archive);
  registerTabView("/settings", SettingsView);
  registerTabView("/git", GitView);
  registerTabView("/terminal", TerminalView);

  // 深链接 views（main 区非 tab 路径）
  registerDeepLinkView("/article", ArticleView);
  registerDeepLinkView("/tags", TagsView);

  // pop views
  registerPopView("/search", SearchView);
  registerPopView("/notifications", SearchView);

  // 新 pop 路径兼容
  registerPopView("/app/search", SearchView);
  registerPopView("/app/notifications", NotificationsView);
}

// 模块加载时立即注册
ensureViewsRegistered();
