import { fetchGithub } from "$lib/auth/session.svelte";
import GitHost, { type GitHostInstance } from "hosted-git-info";
/**
 * 仓库 Markdown 渲染 + 媒体 raw URL 生成（hosted-git-info）。
 *
 * 用 hosted-git-info 解析当前仓库，把 Markdown 里的相对路径（./docs/x.png、api.md）
 * 重写为 raw.githubusercontent.com / GitHub browse 绝对 URL。
 *
 * 与 MarkdownViewer 的分工：
 * - MarkdownViewer：通用 Markdown 渲染（文章正文），无路径重写。
 * - readme.ts：仓库内 Markdown 专用（README 或任意 .md），用 hosted-git-info 做相对路径转换。
 *   另提供 fileRawUrl 生成任意文件（图片/视频/音频）的 raw URL。
 */
import { Marked } from "marked";

/** 判断 href 是否为相对路径（非 http(s)://、非 data:、非锚点）。 */
function isRelative(href: string): boolean {
  if (!href) return false;
  if (href.startsWith("#")) return false;
  if (href.startsWith("http://") || href.startsWith("https://")) return false;
  if (href.startsWith("data:")) return false;
  if (href.startsWith("mailto:")) return false;
  return true;
}

/**
 * 把相对路径规范化为仓库内绝对路径（不含 ./ ../）。
 * @param baseDir README 所在目录（仓库内相对路径，如 '' 或 'docs'）
 * @param rel 相对路径（如 './x.png'、'../images/y.png'、'api.md'）
 */
function resolveRelative(baseDir: string, rel: string): string {
  const cleanRel = rel.replace(/^\.?\//, ""); // 去掉前导 ./ 或 /
  if (!baseDir) return cleanRel;
  const stack = baseDir.split("/").filter(Boolean);
  for (const seg of cleanRel.split("/")) {
    if (seg === "..") stack.pop();
    else if (seg !== ".") stack.push(seg);
  }
  return stack.join("/");
}

/**
 * 解析仓库为 GitHost 实例（用于 file/browse URL 生成）。
 * @param owner 仓库 owner
 * @param repo 仓库名
 * @param committish 分支名（如 'main'）。GitHub raw 端点只认分支名，
 *   不认 HEAD 或 refs/heads/main。调用方应传仓库的 default_branch。
 */
export function parseRepo(owner: string, repo: string, committish = ""): GitHostInstance | null {
  const info = GitHost.fromUrl(`https://github.com/${owner}/${repo}`);
  if (!info) return null;
  info.committish = committish;
  return info;
}

/**
 * 把相对路径转成 GitHub raw URL。
 * @param info 仓库 GitHost 实例（由 parseRepo 创建）
 * @param baseDir 文件所在目录
 * @param href 相对路径
 */
export function toRawUrl(info: GitHostInstance, baseDir: string, href: string): string {
  const resolved = resolveRelative(baseDir, href);
  return info.file(resolved);
}

/**
 * 便捷生成仓库内任意文件的 raw URL（供 img/video/audio src 用）。
 * @param owner 仓库 owner
 * @param repo 仓库名
 * @param filePath 仓库内文件路径（如 'docs/logo.png'）
 * @param branch 分支名（如 'main'，传仓库 default_branch）。raw 端点只认分支名。
 */
export function fileRawUrl(owner: string, repo: string, filePath: string, branch = ""): string {
  const info = parseRepo(owner, repo, branch);
  if (!info || !branch) {
    // parseRepo 失败或无分支时 fallback 到 raw.githubusercontent.com 直接拼接
    return `https://raw.githubusercontent.com/${owner}/${repo}/${branch || "HEAD"}/${filePath}`;
  }
  return info.file(filePath);
}

/**
 * 从 GitHub 拉取 README 文本。
 * 尝试 README.md、README.markdown、README（按 GitHub 惯例）。
 * @param owner 仓库 owner
 * @param repo 仓库名
 * @returns { content, path } 成功；{ content: null, path: null } 无 README
 */
export async function fetchReadme(
  owner: string,
  repo: string,
): Promise<{ content: string; path: string } | { content: null; path: null }> {
  // GitHub Contents API 的 /readme 端点直接返回 README（自动识别文件名）
  const resp = await fetchGithub(`repos/${owner}/${repo}/readme`);
  if (!resp.ok) {
    if (resp.status === 404) return { content: null, path: null };
    return { content: null, path: null };
  }
  const data = (await resp.json()) as {
    content: string;
    encoding: string;
    path: string;
    name: string;
  };
  if (data.encoding !== "base64") return { content: null, path: null };
  // base64 → utf-8（GitHub 返回的 base64 可能含换行）
  const clean = data.content.replace(/\n/g, "");
  const bytes = Uint8Array.from(atob(clean), (c) => c.charCodeAt(0));
  const content = new TextDecoder("utf-8").decode(bytes);
  return { content, path: data.path };
}

/**
 * 文件所在目录（用于解析相对路径）。
 * 通常为 ''（根目录），子目录文件才非空。
 */
function fileDir(filePath: string): string {
  const idx = filePath.lastIndexOf("/");
  return idx === -1 ? "" : filePath.slice(0, idx);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * 渲染仓库内任意 Markdown 文件为 HTML（带相对路径重写）。
 *
 * 通用化的 README 渲染：把文件内的相对路径（./docs/x.png、api.md）重写为
 * raw.githubusercontent.com（图片）/ GitHub browse（链接）绝对 URL。
 *
 * @param markdown 文件文本
 * @param filePath 文件在仓库中的路径（如 'README.md' 或 'docs/guide.md'），用于推导相对路径基准
 * @param owner 仓库 owner
 * @param repo 仓库名
 * @param opts hosted-git-info 选项（committish 等）
 */
export function renderRepoMarkdown(
  markdown: string,
  filePath: string,
  owner: string,
  repo: string,
  opts?: { branch?: string },
): string {
  const info = parseRepo(owner, repo, opts?.branch ?? "");
  const baseDir = fileDir(filePath);

  // 独立 Marked 实例（避免污染 MarkdownViewer 的全局配置）
  const marked = new Marked();
  const renderer = new marked.Renderer();

  // 重写图片相对路径 → raw URL
  renderer.image = ({
    href,
    title,
    text,
  }: {
    href: string;
    title?: string | null;
    text?: string | null;
  }) => {
    const url = info && isRelative(href) ? toRawUrl(info, baseDir, href) : href;
    const t = title ?? "";
    return `<img src="${escapeHtml(url)}" alt="${escapeHtml(text ?? "")}"${
      t ? ` title="${escapeHtml(t)}"` : ""
    } loading="lazy" style="max-width:100%;height:auto;border-radius:8px" />`;
  };

  // 重写链接相对路径 → 应用内导航（SPA 跳到 ?file=path），而非 GitHub browse。
  // 设计：相对链接（./docs/x.md、api.md）在应用内有意义，应跳到文件面板查看；
  // 绝对 URL（http(s)://）和锚点（#section）保持原样由浏览器处理。
  // 实现：生成 <a data-repo-file="path">，由 RepoFileContent 的 click 委托拦截，
  // 调用 navigateSelect('files', 'file', path) 切换文件面板。
  // href 仍保留为 GitHub browse URL（作为 fallback：中键新窗、SEO、无 JS 环境）。
  renderer.link = ({
    href,
    title,
    tokens,
  }: {
    href: string;
    title?: string | null;
    tokens: unknown[];
  }) => {
    const text = marked.Parser.parseInline(tokens as never);
    const t = title ?? "";
    if (info && isRelative(href)) {
      const resolved = resolveRelative(baseDir, href);
      const browseUrl = info.browse(resolved);
      // data-repo-file 标记应用内导航目标；href 作 fallback
      return `<a href="${escapeHtml(browseUrl)}" data-repo-file="${escapeHtml(resolved)}"${t ? ` title="${escapeHtml(t)}"` : ""}>${text}</a>`;
    }
    return `<a href="${escapeHtml(href)}"${t ? ` title="${escapeHtml(t)}"` : ""}>${text}</a>`;
  };

  marked.use({ renderer });
  return marked.parse(markdown, { async: false }) as string;
}
