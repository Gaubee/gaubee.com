import { describe, expect, it } from "vitest";

import { shortcutAction } from "./shortcuts";

describe("shortcutAction", () => {
	it("识别 Cmd/Ctrl+Shift 快捷键", () => {
		expect(shortcutAction({ key: "f", ctrlKey: true, shiftKey: true })).toBe("format");
		expect(shortcutAction({ key: "M", metaKey: true, shiftKey: true })).toBe("minify");
		expect(shortcutAction({ key: "c", metaKey: true, shiftKey: true })).toBe("copy");
		expect(shortcutAction({ key: "v", ctrlKey: true, shiftKey: true })).toBe("toggle-view");
		expect(shortcutAction({ key: "x", ctrlKey: true, shiftKey: true })).toBe("clear");
	});

	it("不劫持普通输入、Alt 组合和未知键", () => {
		expect(shortcutAction({ key: "f", ctrlKey: true })).toBeNull();
		expect(shortcutAction({ key: "f", ctrlKey: true, shiftKey: true, altKey: true })).toBeNull();
		expect(shortcutAction({ key: "z", ctrlKey: true, shiftKey: true })).toBeNull();
	});
});
