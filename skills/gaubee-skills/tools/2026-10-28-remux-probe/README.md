# remux-probe — 本地媒体无损重封装可行性探针

## 是什么

拿到一个本地视频，先回答「能不能不转码、只重封装（remux）就达成目的」。ffprobe 只读探测流结构，输出容器/时长/逐类流清单与判读（哪些流可直接 copy、字幕在目标容器的兼容性、数据流可否丢弃）。零写入、秒级退出。

## 解决什么

mkvgo（纯 Go 无损 remux）进入 omni 工具箱后，remux 成为日常操作；每次都要手工 ffprobe 看流结构再判断。本工具把判读规则固化：h264/hevc/vp9/av1 视频、aac/mp3/ac3/eac3/opus/flac 音频直接 copy；多视频流、非常规音频编码、字幕容器限制（mp4 只收 mov_text）、数据流丢弃建议逐条提示。

## 怎么跑

```bash
bun tools/2026-10-28-remux-probe/remux-probe.ts <media-file> [more...]
```

## 真实示例输出（2026-10-28，staging 真实样本）

```text
/…/2111927727318245426-video.mp4
  容器 mov｜3.7 MB｜30s
  流：视频 h264(默认)｜音频 aac.und｜字幕 0｜数据/附件 0
  判读：视频 h264 可直接 copy；音频 aac 可直接 copy，可直接无损重封装
```

无音轨样本（X 动图常态）输出「无音轨（动图常态，remux 无碍）」提示而非误报警告。

## 边界

- 只探测不执行——实际 remux 交给 mkvgo/ffmpeg；判读基于「主流容器 × 常见编码」经验规则，罕见组合（如 ProRes、真彩 HDR）以 ffprobe 原始输出为准。
- 依赖系统 ffprobe（管道可选依赖，本机已装）。
