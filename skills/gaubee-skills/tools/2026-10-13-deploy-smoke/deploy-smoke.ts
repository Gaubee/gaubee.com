// deploy-smoke.ts — 发布后公网冒烟（工坊 2026-10-13 提案 1）
//
// 动机（2026-10-13 WAF 事故实证）：CI 绿 + watchtower 重建 ≠ 站点可达——1Panel WAF
// 的 defaultUrlBlack 规则 `\.git` 子串命中 `.github-daily`，全部 GitHub 日报详情页
// 对公网 403「请求拦截」，而发布链（镜像构建/容器重建/页面文件在镜像内）全绿。
// 容器侧取证看不见代理层的拦截，只有从公网侧请求才知道。
//
// 做什么：对站点仓库 src/content/events 最新 N 篇 event，逐个 GET 公网详情页，
// 断言：HTTP 200、非 SPA 壳（字节数 > 壳基线）、非「请求拦截」页、title 含 stem。
// 只读，不改任何状态；零第三方依赖（fetch 内建）。
//
// 用法: bun tools/2026-10-13-deploy-smoke/deploy-smoke.ts [--n 8] [--base https://gaubee.com]
// 退出码：0 = 全部通过；1 = 有失败项（cron 发布后可作门禁）。
const SITE_ROOT = new URL("../../../..", import.meta.url).pathname;
const SHELL_BASELINE_BYTES = 5000; // SPA 壳 4556B；真实内容页远大于此

interface Args {
  n: number;
  base: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { n: 8, base: "https://gaubee.com" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--n") args.n = Number(argv[++i]);
    else if (argv[i] === "--base") args.base = argv[++i]!;
  }
  if (!Number.isInteger(args.n) || args.n <= 0) throw new Error(`--n 非法: ${args.n}`);
  return args;
}

async function main(): Promise<void> {
  const { n, base } = parseArgs(process.argv.slice(2));
  const eventsDir = `${SITE_ROOT}/src/content/events`;
  const stems = (await Array.fromAsync(new Bun.Glob("*.md").scan({ cwd: eventsDir })))
    .sort()
    .slice(-n)
    .map((f) => f.replace(/\.md$/, ""));
  if (stems.length === 0) throw new Error("src/content/events 为空？");

  let failed = 0;
  for (const stem of stems) {
    const url = `${base}/pages/article/events/${stem}`;
    // title 语义两态：md 无 frontmatter title 时页面标题 = stem；有则为标题本身（如周报）
    const md = await Bun.file(`${eventsDir}/${stem}.md`).text();
    const fmTitle = md.match(/^title:\s*"?([^"\n]+)"?/m)?.[1]?.trim();
    try {
      const res = await fetch(url, { redirect: "follow" });
      const body = await res.text();
      const titleTag = body.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
      const problems: string[] = [];
      if (res.status !== 200) problems.push(`HTTP ${res.status}`);
      if (body.length <= SHELL_BASELINE_BYTES) problems.push(`疑似 SPA 壳（${body.length}B）`);
      if (body.includes("请求拦截")) problems.push("WAF 拦截页");
      if (!titleTag.includes(stem) && !(fmTitle && titleTag.includes(fmTitle))) {
        problems.push(`title 不含 stem/frontmatter 标题（got「${titleTag}」）`);
      }
      if (problems.length) {
        failed++;
        console.log(`FAIL ${stem} → ${problems.join("；")}（${url}）`);
      } else {
        console.log(`PASS ${stem}（${body.length}B）`);
      }
    } catch (e) {
      failed++;
      console.log(`FAIL ${stem} → 网络异常: ${e instanceof Error ? e.message : e}`);
    }
  }
  console.log(failed === 0 ? `SMOKE OK：${stems.length} 篇全过` : `SMOKE FAIL：${failed}/${stems.length} 不过`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
