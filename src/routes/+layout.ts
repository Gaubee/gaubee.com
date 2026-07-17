// 整个应用是 SPA：NavController 接管所有路由，SvelteKit 只输出空 shell。
// SSR 关闭（编辑器应用弱 SEO），prerender 打开（让 adapter-static 输出 index.html fallback）。
export const ssr = false;
export const prerender = true;
