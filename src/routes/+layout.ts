// SPA 模式：NavController 接管所有路由，SvelteKit 只作为应用容器。
// ssr 关闭（编辑器应用弱 SEO，且 NavController 依赖浏览器 API）。
// prerender 关闭——由 adapter-static 的 fallback: 'index.html' 统一处理所有路径，
// 避免动态 catch-all 路由与预渲染爬取冲突。
export const ssr = false;
export const prerender = false;
