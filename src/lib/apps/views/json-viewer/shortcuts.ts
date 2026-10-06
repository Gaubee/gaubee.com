/** JSON 查看器全局快捷键映射（纯函数，server project 可测）。 */

export type JsonViewerShortcutAction = "format" | "minify" | "copy" | "toggle-view" | "clear";

export interface ShortcutKeyEvent {
	key: string;
	metaKey?: boolean;
	ctrlKey?: boolean;
	shiftKey?: boolean;
	altKey?: boolean;
}

/** 返回快捷键动作；只接受 Cmd/Ctrl+Shift 组合，避免劫持普通输入。 */
export function shortcutAction(event: ShortcutKeyEvent): JsonViewerShortcutAction | null {
	if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.altKey) return null;
	switch (event.key.toLowerCase()) {
		case "f":
			return "format";
		case "m":
			return "minify";
		case "c":
			return "copy";
		case "v":
			return "toggle-view";
		case "x":
			return "clear";
		default:
			return null;
	}
}
