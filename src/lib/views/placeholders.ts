/**
 * View 注册：所有 tab/pop 路由的视图组件。
 *
 * 在模块加载时立即注册（registry 是静态映射，不需要等组件挂载），
 * 这样 AreaOutlet 首次渲染时 views 已就绪。
 *
 * 后续阶段（5/6/7）会替换这里的占位组件为真实功能 view。
 */
import Archive from './ArchiveView.svelte'
import ChangesView from './ChangesView.svelte'
import EditorView from './EditorView.svelte'
import FilesView from './FilesView.svelte'
import FeedView from './FeedView.svelte'
import GitView from './GitView.svelte'
import PreviewServerView from './PreviewServerView.svelte'
import SearchView from './SearchView.svelte'
import SettingsView from './SettingsView.svelte'
import { registerPopView, registerTabView } from './registry'

let registered = false

/** 注册所有 view（幂等，多次调用安全）。 */
export function ensureViewsRegistered(): void {
  if (registered) return
  registered = true

  // main tab views
  registerTabView('/feed', FeedView)
  registerTabView('/editor', EditorView)
  registerTabView('/files', FilesView)
  registerTabView('/changes', ChangesView)
  registerTabView('/archive', Archive)
  registerTabView('/settings', SettingsView)

  // bottom tab views
  registerTabView('/git', GitView)
  registerTabView('/preview-server', PreviewServerView)

  // pop views
  registerPopView('/search', SearchView)
  registerPopView('/notifications', SearchView) // 暂用 SearchView 占位
}

// 模块加载时立即注册
ensureViewsRegistered()
