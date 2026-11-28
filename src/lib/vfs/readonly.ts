/**
 * 只读内容 reader —— 按需拉取构建期 markdown。
 *
 * 设计目标（2026-11-28 启动性能改造）：
 * - 不再把全部正文内联进客户端首屏（旧 readonly-data.ts 为 11.36MB）。
 * - 列表/摘要走 readonly-index.ts 的轻量元数据；正文只在真正阅读时从
 *   /pages/raw/<collection>/<filename> 拉取（同源、可缓存、无需 GitHub API）。
 * - 只读：不提供 write/unlink/commit 等修改接口。
 *
 * 只接受 src/content/(articles|events)/*.md，与 raw 端点的暴露范围一致。
 */

const RAW_PREFIX = "/pages/raw/";
const CONTENT_PATH_RE = /^src\/content\/(articles|events)\/[^/]+\.md$/;

export class ReadonlyVfs {
  private readonly cache = new Map<string, string>();
  private readonly inflight = new Map<string, Promise<string | null>>();

  /** 读取构建期内容文件的原始 markdown；不存在或路径不合法时返回 null。 */
  async readFile(path: string): Promise<string | null> {
    if (!CONTENT_PATH_RE.test(path)) return null;

    const cached = this.cache.get(path);
    if (cached !== undefined) return cached;

    const pending = this.inflight.get(path);
    if (pending) return pending;

    const url = `${RAW_PREFIX}${path.slice("src/content/".length)}`;
    const request = fetch(url, { headers: { accept: "text/markdown" } })
      .then(async (res) => {
        if (!res.ok) return null;
        const text = await res.text();
        this.cache.set(path, text);
        return text;
      })
      .catch(() => null)
      .finally(() => {
        this.inflight.delete(path);
      });

    this.inflight.set(path, request);
    return request;
  }
}

/** 单例。 */
export const readonlyVfs = new ReadonlyVfs();
