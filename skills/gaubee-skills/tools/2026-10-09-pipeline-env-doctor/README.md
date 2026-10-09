# pipeline-env-doctor

## 是什么

gaubee-skills 每日管道的运行环境自检：必需/可选二进制可达性、gh 登录态、私有数据根
可写、.env 关键键名存在（只查键名，绝不输出值）。一条命令回答「今天管道能不能跑」。

## 解决什么

2026-10-09 实证：cron 在裁剪版 PATH 下启动，bun/node/ego-browser 全部 command not
found，六源抓取第一步就断。本工具把这类故障从「跑到一半炸」提前到「跑之前就知道」，
并给出缺失项的修复提示。

## 怎么跑

```sh
bun ~/.agents/skills/gaubee-skills/tools/2026-10-09-pipeline-env-doctor/pipeline-env-doctor.ts
bun ~/.agents/skills/gaubee-skills/tools/2026-10-09-pipeline-env-doctor/pipeline-env-doctor.ts --json
```

退出码：全就绪 0；有缺失 1（可作 cron 第 0 步门禁）；用法错误 2。

## 真实示例输出（2026-10-09 实跑）

修复后 PATH（12 项全绿，exit 0）：

```
pipeline-env-doctor：12 项检查
  ok   bin:bun  /Users/kzf/.vite-plus/package_manager/bun/1.4.2/bun/bin/bun
  ok   bin:node  /Users/kzf/.vite-plus/js_runtime/node/24.21.0/bin/node
  ok   bin:gh  /opt/homebrew/bin/gh
  ok   bin:git  /usr/bin/git
  ok   bin:curl  /usr/bin/curl
  ok   bin:jq  /usr/bin/jq
  ok   bin(可选):ego-browser  /Users/kzf/.local/bin/ego-browser
  ok   bin(可选):yt-dlp  /opt/homebrew/bin/yt-dlp
  ok   bin(可选):ffprobe  /opt/homebrew/bin/ffprobe
  ok   gh:auth  已登录
  ok   data:root 可写  /Users/kzf/.gaubee-skills
  ok   env:GAUBEE_SKILLS_VAULT_KEY  键存在（值不读取）

OK：管道环境就绪
```

裁剪环境复现（env -i 剥掉 profile 后，exit 1）：

```
  FAIL gh:auth  未登录或 token 失效
       hint: gh auth login
  ...
1 项不就绪（管道会部分或全部中断）
```

注：二进制查找经 `bash -lc`（登录 shell 会加载用户 profile，等价于 cron 子进程的
解析路径）；gh 登录态等非 profile 依赖在剥离环境下仍会如实 FAIL。
