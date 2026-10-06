/**
 * json CLI 命令（通过 manifest.cliCommands 接入 Terminal PATH）。
 * 支持 `json validate|format|minify [文件|-]`；`-` 或省略参数读取标准输入。
 */

import type { CliCommand, CliCommandContext } from "$lib/apps/types";
import { vfs } from "$lib/vfs/vfs";

import { parseJson } from "./json-core";

const NEWLINE = "\r\n";

export const jsonCommands: CliCommand[] = [
	{
		name: "json validate",
		usage: "json validate [file|-]",
		description: "校验 JSON；不传文件或传 - 时读取标准输入。",
		run: (ctx, args) => runJsonCommand(ctx, args, "validate"),
	},
	{
		name: "json format",
		usage: "json format [file|-]",
		description: "格式化 JSON 为 2 空格缩进并输出。",
		run: (ctx, args) => runJsonCommand(ctx, args, "format"),
	},
	{
		name: "json minify",
		usage: "json minify [file|-]",
		description: "压缩 JSON 并输出单行结果。",
		run: (ctx, args) => runJsonCommand(ctx, args, "minify"),
	},
];

type JsonCommand = "validate" | "format" | "minify";

async function runJsonCommand(
	ctx: CliCommandContext,
	args: string[],
	command: JsonCommand,
): Promise<{ exit: number; newCwd: string | null }> {
	const source = await readSource(ctx, args[2]);
	if (!source.ok) {
		ctx.writeErr(`json ${command}: ${source.error}${NEWLINE}`);
		return { exit: 1, newCwd: null };
	}
	const outcome = parseJson(source.text);
	if (!outcome.ok) {
		const location = outcome.error.line > 0 ? `第 ${outcome.error.line} 行第 ${outcome.error.column} 列` : "未知位置";
		ctx.writeErr(
			`json ${command}: ${location} ${outcome.error.message}。建议：${outcome.error.suggestion}${NEWLINE}`,
		);
		return { exit: 1, newCwd: null };
	}
	if (command === "validate") {
		ctx.write(`✓ JSON 合法${NEWLINE}`);
	} else {
		ctx.write(`${JSON.stringify(outcome.value, null, command === "format" ? 2 : undefined)}${NEWLINE}`);
	}
	return { exit: 0, newCwd: null };
}

async function readSource(
	ctx: CliCommandContext,
	file: string | undefined,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
	if (!file || file === "-") {
		if (typeof ctx.stdin !== "string") return { ok: false, error: "没有标准输入，请传入文件路径" };
		return { ok: true, text: ctx.stdin };
	}
	try {
		return { ok: true, text: await vfs.readFile(resolvePath(ctx.cwd, file)) };
	} catch {
		return { ok: false, error: `文件不存在：${file}` };
	}
}

function resolvePath(cwd: string, input: string): string {
	const absolute = input.startsWith("/");
	const base = (absolute ? input.slice(1) : `${cwd}/${input}`).split("/");
	const result: string[] = [];
	for (const segment of base) {
		if (!segment || segment === ".") continue;
		if (segment === "..") result.pop();
		else result.push(segment);
	}
	return result.join("/");
}
