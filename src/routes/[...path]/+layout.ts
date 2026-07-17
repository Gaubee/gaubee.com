// SPA 编辑器路由：纯客户端渲染（NavController 依赖浏览器 API）。
// 这里下放 ssr/prerender，避免污染根 layout（根 layout 服务 SSG 阅读站，需 SSR）。
export const ssr = false;
export const prerender = false;
