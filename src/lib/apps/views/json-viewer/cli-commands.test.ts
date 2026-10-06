import { describe, expect, it } from "vitest";

import { jsonCommands } from "./cli-commands";

function context(stdin: string) {
	const output: string[] = [];
	const errors: string[] = [];
	return {
		ctx: {
			cwd: "src/content",
			stdin,
			write: (text: string) => output.push(text),
			writeErr: (text: string) => errors.push(text),
			clear: () => undefined,
		},
		output,
		errors,
	};
}

describe("json CLI 命令", () => {
	it("validate 从 stdin 校验合法 JSON", async () => {
		const item = context('{"a":1}');
		const result = await jsonCommands[0].run(item.ctx, ["json", "validate", "-"]);
		expect(result.exit).toBe(0);
		expect(item.output.join("")).toContain("JSON 合法");
	});

	it("format 与 minify 输出预期格式", async () => {
		const formatted = context('{"a":[1,true]}');
		await jsonCommands[1].run(formatted.ctx, ["json", "format", "-"]);
		expect(formatted.output.join("")).toContain("\n  \"a\": [");
		const minified = context('{ "a": 1 }');
		await jsonCommands[2].run(minified.ctx, ["json", "minify", "-"]);
		expect(minified.output.join("")).toBe('{"a":1}\r\n');
	});

	it("非法 JSON 返回非零退出码与修复建议", async () => {
		const item = context('{"a":}');
		const result = await jsonCommands[0].run(item.ctx, ["json", "validate", "-"]);
		expect(result.exit).toBe(1);
		expect(item.errors.join("")).toContain("建议：");
	});
});
