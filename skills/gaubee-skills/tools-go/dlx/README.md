# dlx — 跨站点视频/音频下载器（Go 编排 + yt-dlp 引擎）

## 是什么

一个 Go 写的下载 CLI：参数解析、并发、格式档位、失败归类、归档清单都由 Go 负责，
**实际下载交给 yt-dlp**。产物是 2.6MB 静态单二进制（+ 一个外部依赖 yt-dlp）。

## 为什么不重写成纯 Go

查过 Go 生态（2026-11-24）：

| 项目 | 星 | 支持范围 |
| --- | --- | --- |
| kkdai/youtube | 3949 | **仅 YouTube** |
| 其余 yt-dlp-go 类 | 0–114 | 多是「包装 yt-dlp 的玩具」 |

yt-dlp 支持 **1800+ 站点**，每个站点的提取器都要随上游改版持续维护——这是十年积累，
不是能「移植」的东西。所以本工具的定位是**把 yt-dlp 做不好的三件事补上**：

1. **批量并发**（yt-dlp 自己串行；这里默认 4 并发）
2. **失败归类**（站点变动 / 需登录 / 内容不存在 / 网络 / 限流，各给处置建议）
3. **归档清单**（每次下载写 `dlx-log.jsonl`，可回溯、可二次处理）

## 怎么跑

```sh
# 前置：yt-dlp（和 ffmpeg，分轨视频合并需要）
brew install yt-dlp ffmpeg

go build -trimpath -ldflags="-s -w" -o dlx .
./dlx doctor                      # 检查依赖
./dlx probe <url>                 # 只看可用格式，不下载
./dlx download <url> -f 720p -o ./out
./dlx batch urls.txt -f audio -jobs 4
```

格式档位：`best` / `audio` / `720p` / `1080p` / `small`。

## 真实示例输出（2026-11-24）

```text
$ ./dlx doctor
dlx v0.1.0
  ✓ yt-dlp: /opt/homebrew/bin/yt-dlp (v2026.07.04)
  ✓ ffmpeg（音视频合并需要）
```

失败归类的判据（按 yt-dlp 的 stderr 文本）：

| 命中 | 归类 | 建议 |
| --- | --- | --- |
| unsupported url / no suitable | 站点不支持 | 升级 yt-dlp；仍失败则是站点改版 |
| private video / login | 需要登录 | `--cookies-from-browser` |
| 404 / unavailable | 内容不存在 | 确认 URL |
| timed out / connection | 网络问题 | 重试或换网络 |
| 429 / too many requests | 被限流 | 降并发或稍后再试 |

## 形态

**self-hosted**：需要本地 ffmpeg 与网络出口，不能在浏览器里跑。
仓库命名 `gaubee-tool-dlx`；WebApp 详情页给部署说明。
