/**
 * 剪贴板工具：封装 navigator.clipboard.writeText，带降级处理。
 *
 * 2026-08-02：为 GithubEditor 文件树操作（复制路径等）提供。
 * 在非安全上下文（http + 非 localhost）或无权限时 clipboard API 可能不可用，
 * 降级抛错由调用方决定如何提示。
 */

/**
 * 写文本到剪贴板。
 * @throws Error 当 clipboard API 不可用时
 */
export async function copyText(text: string): Promise<void> {
  if (!navigator.clipboard) {
    throw new Error("剪贴板 API 不可用（需要 HTTPS 或 localhost）");
  }
  await navigator.clipboard.writeText(text);
}
