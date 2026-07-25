import { fetchGithub } from "$lib/auth/session.svelte";
import GitHost, { type GitHostInstance } from "hosted-git-info";
/**
 * README 拉取 + 渲染（带相对路径重写）。
 *
 * 用 hosted-git-info 解析当前仓库，把 README 里的相对路径（./docs/x.png、docs/api.md）
 * 重写为 raw.githubusercontent.com 绝对 URL，确保离线渲染时图片/链接可用。
 *
 * 与 MarkdownViewer 的分工：
 * - MarkdownViewer：通用 Markdown 渲染（文章正文），无路径重写。
 * - readme.ts：GitHub 仓库 README 专用，用 hosted-git-info 做相对路径 → raw URL 转换。
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
 * @param committish 分支/ref（默认 HEAD，跟随默认分支）
 */
export function parseRepo(
  owner: string,
  repo: string,
  committish = "HEAD",
): GitHostInstance | null {
  const info = GitHost.fromUrl(`https://github.com/${owner}/${repo}`);
  if (!info) return null;
  info.committish = committish;
  return info;
}

/**
 * 把相对路径转成 GitHub raw URL。
 * @param info 仓库 GitHost 实例（由 parseRepo 创建）
 * @param baseDir README 所在目录
 * @param href 相对路径
 */
export function toRawUrl(info: GitHostInstance, baseDir: string, href: string): string {
  const resolved = resolveRelative(baseDir, href);
  return info.file(resolved);
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
 * README 所在目录（用于解析相对路径）。
 * 通常为 ''（根目录），子目录仓库的 README 才非空。
 */
function readmeDir(readmePath: string): string {
  const idx = readmePath.lastIndexOf("/");
  return idx === -1 ? "" : readmePath.slice(0, idx);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * 渲染 README 为 HTML（带相对路径重写）。
 * @param markdown README 文本
 * @param readmePath README 在仓库中的路径（如 'README.md' 或 'docs/README.md'）
 * @param owner 仓库 owner
 * @param repo 仓库名
 * @param opts hosted-git-info 选项（committish 等，通过 parseRepo 传入）
 */
export function renderReadme(
  markdown: string,
  readmePath: string,
  owner: string,
  repo: string,
  opts?: { committish?: string },
): string {
  const info = parseRepo(owner, repo, opts?.committish ?? "HEAD");
  const baseDir = readmeDir(readmePath);

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

  // 重写链接相对路径 → browse URL（网页浏览，而非 raw）
  renderer.link = ({
    href,
    title,
    tokens,
  }: {
    href: string;
    title?: string | null;
    tokens: unknown[];
  }) => {
    let url = href;
    if (info && isRelative(href)) {
      // 链接到 .md 等文档时用 browse（GitHub 网页），否则也用 browse
      const resolved = resolveRelative(baseDir, href);
      url = info.browse(resolved);
    }
    const text = marked.Parser.parseInline(tokens as never);
    const t = title ?? "";
    return `<a href="${escapeHtml(url)}"${t ? ` title="${escapeHtml(t)}"` : ""}>${text}</a>`;
  };

  marked.use({ renderer });
  return marked.parse(markdown, { async: false }) as string;
}
