/**
 * parseGithubUrl：从用户输入解析 GitHub 仓库信息。
 *
 * 支持的格式：
 * - https://github.com/owner/repo
 * - https://github.com/owner/repo/tree/branch
 * - https://github.com/owner/repo/tree/branch/path/to/file
 * - https://github.com/owner/repo/blob/branch/path/to/file
 * - git@github.com:owner/repo.git
 * - owner/repo（短格式）
 *
 * @returns { owner, repo, branch?, path? } 或 null（非 GitHub 链接）
 */

export interface ParsedGithubUrl {
  owner: string;
  repo: string;
  /** 分支名（URL 含 /tree/{branch} 或 /blob/{branch} 时提取）。 */
  branch?: string;
  /** 文件/文件夹路径（branch 之后的路径段）。 */
  path?: string;
}

/**
 * 解析 GitHub URL。
 *
 * 实现策略：优先用 URL 构造器解析 path 段（支持 tree/blob/commit + branch + path），
 * 因为 hosted-git-info 对 /blob/ 路径不识别。仅 owner/repo 短格式和 git@ SSH 用正则。
 */
export function parseGithubUrl(input: string): ParsedGithubUrl | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // 短格式 owner/repo（无协议前缀，无斜杠路径）
  const shortMatch = trimmed.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (shortMatch) {
    const repo = shortMatch[2].replace(/\.git$/, "");
    return { owner: shortMatch[1], repo };
  }

  // git@ SSH 格式：git@github.com:owner/repo.git 或 git@github.com:owner/repo.git@branch
  const sshMatch = trimmed.match(/^git@github\.com:([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:@(.+))?$/);
  if (sshMatch) {
    const result: ParsedGithubUrl = { owner: sshMatch[1], repo: sshMatch[2] };
    if (sshMatch[3]) result.branch = sshMatch[3];
    return result;
  }

  // https/http URL：用 URL 构造器解析 path 段
  let url: URL;
  try {
    url = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }

  // 仅接受 github.com 域
  if (url.hostname !== "github.com" && url.hostname !== "www.github.com") {
    return null;
  }

  const parts = url.pathname.split("/").filter(Boolean);
  // 至少 owner/repo 两段
  if (parts.length < 2) return null;

  const result: ParsedGithubUrl = {
    owner: decodeURIComponent(parts[0]),
    repo: decodeURIComponent(parts[1]).replace(/\.git$/, ""),
  };

  // parts[2]=tree|blob|commit, parts[3]=branch, parts[4+]=path
  if (parts.length >= 4 && (parts[2] === "tree" || parts[2] === "blob" || parts[2] === "commit")) {
    result.branch = decodeURIComponent(parts[3]);
    if (parts.length > 4) {
      result.path = parts.slice(4).map(decodeURIComponent).join("/");
    }
  }

  return result;
}
