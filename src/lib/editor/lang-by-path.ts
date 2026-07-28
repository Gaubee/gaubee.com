import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { yaml } from "@codemirror/lang-yaml";
/**
 * 按文件路径选择 CodeMirror 语言扩展。
 *
 * GithubEditorApp 编辑任意仓库文件时，按扩展名匹配语言包。
 * 未知扩展名返回 null（CodeMirror 用纯文本模式）。
 */
import type { Extension } from "@codemirror/state";

/**
 * 根据文件路径返回对应的 CodeMirror 语言扩展。
 * @param filePath 文件路径（如 src/lib/x.ts）
 * @returns 语言扩展，未知返回 null
 */
export function langByPath(filePath: string): Extension | null {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "js":
      return javascript();
    case "ts":
      return javascript({ typescript: true });
    case "jsx":
      return javascript({ jsx: true });
    case "tsx":
      return javascript({ jsx: true, typescript: true });
    case "mjs":
    case "cjs":
      return javascript();
    case "json":
      return json();
    case "css":
      return css();
    case "html":
    case "htm":
    case "xml":
    case "svg":
      return html();
    case "yaml":
    case "yml":
      return yaml();
    default:
      return null;
  }
}
