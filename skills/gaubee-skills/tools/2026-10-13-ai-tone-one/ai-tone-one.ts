// ai-tone-one.ts — ai-tone 单文件体检（工坊 2026-10-13 提案 2）
//
// 动机（2026-10-13 实证）：scripts/ai-tone-metrics.mjs 无参数处理，永远全目录扫描
// （今天 200+ 份历史报告一起出报告，找自己文件的结果要在上千行输出里 awk）。
// 每日 cron 只需要刚写完的那一份的结论。
//
// 做法：wrapper 调用原脚本（bun 跑 .mjs，零改动零语义漂移），按文件名切出该文件的
// 段落；判定沿用原脚本口径——行尾带 RED/YELLOW/LOW 的行算超标（无标记 = 阈值内，
// 与原脚本 failures 计数一致）；目标文件无超标行则退出 0。
//
// 用法: bun tools/2026-10-13-ai-tone-one/ai-tone-one.ts <报告.md>（相对/绝对路径均可）
// 退出码：0 = 该文件全部指标在阈值内；1 = 有 RED/YELLOW/LOW 行；2 = 用法错误。
const SCRIPT = new URL("../../scripts/ai-tone-metrics.mjs", import.meta.url).pathname;

const arg = process.argv[2];
if (!arg || !arg.endsWith(".md")) {
  console.error("用法: bun tools/2026-10-13-ai-tone-one/ai-tone-one.ts <报告.md>");
  process.exit(2);
}
const target = arg.split("/").pop()!;

const proc = Bun.spawnSync(["bun", SCRIPT], { cwd: new URL("../..", import.meta.url).pathname, stdout: "pipe", stderr: "pipe" });
const out = new TextDecoder().decode(proc.stdout);

// 原脚本输出按「\n<file>\n  行...」分节；切出目标文件节
const lines = out.split("\n");
const startIdx = lines.findIndex((l) => l === target);
if (startIdx < 0) {
  console.error(`ai-tone-one: 输出中找不到 ${target}（原脚本是否扫描了所在目录？）`);
  process.exit(2);
}
const section: string[] = [target];
for (let i = startIdx + 1; i < lines.length; i++) {
  const l = lines[i]!;
  if (l.startsWith("  ") || l.trim() === "") section.push(l);
  else break;
}
console.log(section.join("\n").trimEnd());

const bad = section.filter((l) => /\b(RED|YELLOW|LOW)\s*$/.test(l));
if (bad.length) {
  console.log(`\n✗ ${target}: ${bad.length} 项超标`);
  process.exit(1);
}
console.log(`\n✓ ${target}: 全部指标在阈值内`);
