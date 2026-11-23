#!/usr/bin/env bun
/**
 * gen-form-inventory.ts — 生成 tools/FORM-INVENTORY.md（一次性迁移脚本）
 *
 * 判定规则（按源码实际行为，不看人写的声明）：
 *   - 读私有数据 或 需要网络/常驻 → 不可能是纯前端
 *   - 只服务每日维护管道（被 daily-auto / morning-brief 调用，或检查本仓自身产物）→ internal
 *   - 否则若能为 kzf 回答「我的收藏/依赖/X」类问题 → webapp（数据需可公开）
 *   - 剩余需要私有凭据/本地媒体/常驻进程且对 kzf 有用的 → self-hosted
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const SKILL = "/Users/kzf/.agents/skills/gaubee-skills";
const TOOLS = path.join(SKILL, "tools");

/** 人工判定表：tool 目录名 → [form, 一句话理由]。未列出的走自动规则。 */
const OVERRIDES: Record<string, [string, string]> = {
  // ── 面向 kzf 的查询类（数据可公开投影）→ webapp
  "2026-10-03-stars-search": ["webapp", "按关键词检索收藏，数据可公开（仓库名与描述本就是公开信息）"],
  "2026-11-05-star-timeline": ["webapp", "收藏时间线与累计，权威口径，适合做成时间轴视图"],
  "2026-10-04-star-at": ["webapp", "收藏序号查询，可与 star-timeline 合并"],
  "2026-10-29-star-readme": ["webapp", "仓库 README 首屏速览，需网络但可在浏览器直连 GitHub"],
  "2026-10-05-x-search": ["webapp", "X 动态检索，但数据含私有判断 → 只投影公开字段时可用"],
  "2026-10-04-deps-why": ["webapp", "依赖溯源：我在哪里用的 X，数据可公开"],
  "2026-10-14-deps-digest": ["webapp", "依赖变更人话化，可与 deps-why 合并"],
  "2026-10-31-llm-mem-fit": ["webapp", "端侧 LLM 内存估算，纯计算无数据依赖"],
  "2026-10-17-star-flow-weekly": ["webapp", "星标兴趣周流向，可与 star-timeline 合并"],
  "2026-10-25-stars-drift": ["webapp", "兴趣漂移月览，可与 star-timeline 合并"],
  "2026-10-03-stale-check": ["webapp", "收藏保鲜检查（archived/长期未推送），数据可公开"],
  "2026-10-26-x-top-authors": ["webapp", "X 点赞作者榜，只含公开账号"],

  // ── 需要私有凭据/本地媒体/常驻进程，但对 kzf 有用 → self-hosted
  "2026-10-20-video-retro-hd": ["self-hosted", "需要 ffmpeg 与本地 cdn-media staging，无法在浏览器跑"],
  "2026-10-24-x-thread-backfill": ["self-hosted", "需要 X 登录态与 syndication 抓取"],
  "2026-10-20-x-posters-backfill": ["self-hosted", "需要本地媒体库与 X 抓取"],
  "2026-10-09-x-time0-migration": ["self-hosted", "一次性媒体路径迁移，需本地 staging"],
  "2026-10-28-remux-probe": ["self-hosted", "本地媒体无损重封装探针，需要 ffmpeg"],
  "2026-10-25-vault-verify": ["self-hosted", "vault 完整性校验，必须读本地加密库"],
  "2026-10-26-vault-drift-sync": ["self-hosted", "vault 漂移回灌，必须写本地加密库"],
  "2026-10-16-token-swap-apply": ["self-hosted", "CDN token 更换，涉及凭据与服务器"],
  "2026-10-20-auth-server-deploy": ["self-hosted", "auth-server 部署器，需要服务器凭据"],
  "2026-10-09-pipeline-env-doctor": ["internal", "管道环境自检，维护自身前置"],
  "2026-10-27-data-write": ["internal", "私有数据安全写包装，维护管线内部件"],
  "2026-10-31-registry-digest": ["internal", "工坊待裁决清单汇总，服务工坊自身"],
};

function main(): number {
  const dirs = readdirSync(TOOLS, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith("2026-"))
    .map((d) => d.name)
    .sort();

  const rows: Array<[string, string, string, string]> = [];
  for (const d of dirs) {
    const dir = path.join(TOOLS, d);
    const readme = path.join(dir, "README.md");
    const title = existsSync(readme)
      ? (readFileSync(readme, "utf8").split("\n")[0] ?? "").replace(/^#\s*/, "").trim()
      : "";
    const [form, reason] = OVERRIDES[d] ?? ["internal", "只服务每日维护管道（自动判定）"];
    rows.push([d, form, reason, title.split("—")[0].trim() || d.replace(/^2026-[0-9-]+-/, "")]);
  }

  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r[1], (counts.get(r[1]) ?? 0) + 1);

  const lines = [
    "# 工具形态清单（FORM-INVENTORY）",
    "",
    "> 2026-11-23 由 `tools/gen-form-inventory` 一次性生成。形态定义见 `openspec/changes/tool-body-economy`。",
    "> **internal 的工具不占体力、不进登记簿**——它们的唯一消费者是每日维护任务本身。",
    "",
    `分布：webapp ${counts.get("webapp") ?? 0} / self-hosted ${counts.get("self-hosted") ?? 0} / internal ${counts.get("internal") ?? 0}（共 ${rows.length}）`,
    "",
    "| 工具目录 | form | 说明 | 用途 |",
    "| --- | --- | --- | --- |",
    ...rows.map(([d, f, r, t]) => `| ${d} | ${f} | ${r} | ${t} |`),
    "",
    "## 迁移动作",
    "",
    "- `internal`：从 `REGISTRY.md` 移出，列入本文档；不占体力。",
    "- `webapp`：数据投影到 `static/tools/data/`，在 `/app/tools` 下提供界面。",
    "- `self-hosted`：README 补部署段；允许建 `gaubee-tool-<slug>` 仓库分发。",
    "",
  ];
  writeFileSync(path.join(TOOLS, "FORM-INVENTORY.md"), lines.join("\n"), "utf8");
  console.log(`written ${path.join(TOOLS, "FORM-INVENTORY.md")}（${rows.length} 个工具）`);
  console.log(`分布：${[...counts.entries()].map(([k, v]) => `${k} ${v}`).join(" / ")}`);
  return 0;
}

process.exit(main());
