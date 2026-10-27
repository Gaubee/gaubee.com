#!/usr/bin/env bun
/**
 * remux-probe — 本地媒体无损重封装可行性探针
 *
 * 背景（mkvgo 落地信号 + HLS 管道日常）：拿到一个本地视频，想知道「能不能不转码、
 * 只重封装（remux）就达成目的」——换容器、抽音轨、喂 HLS 打包器。本工具用 ffprobe
 * 只读探测流结构，给出逐流清单与 remux 可行性判读（哪些流能直接 copy、哪些是
 * 数据流/封面流建议丢弃或保留、字幕在 mp4 目标容器里的兼容性）。
 *
 * 用法：bun tools/2026-10-28-remux-probe/remux-probe.ts <media-file> [more...]
 * 退出码：0 = 全部探测成功；1 = ffprobe 缺失或文件不可读；2 = 部分文件失败。
 * 只读零写入；依赖系统 ffprobe（可选依赖，管道内已有）。
 */
import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";

interface Stream {
  index: number;
  codec_name?: string;
  codec_type?: string;
  disposition?: Record<string, number>;
  tags?: Record<string, string>;
}

function probe(file: string): { ok: boolean; note: string } {
  if (!existsSync(file) || !statSync(file).isFile()) return { ok: false, note: "文件不存在" };
  const r = spawnSync(
    "ffprobe",
    ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", file],
    { timeout: 30_000 },
  );
  if (r.status !== 0) return { ok: false, note: `ffprobe 失败：${(r.stderr ?? "").toString().slice(0, 120)}` };
  const j = JSON.parse(r.stdout!.toString()) as {
    streams?: Stream[];
    format?: { format_name?: string; size?: number; duration?: string };
  };
  const streams = j.streams ?? [];
  const video = streams.filter((s) => s.codec_type === "video");
  const audio = streams.filter((s) => s.codec_type === "audio");
  const subs = streams.filter((s) => s.codec_type === "subtitle");
  const data = streams.filter((s) => s.codec_type === "data" || s.codec_type === "attachment");
  const lines: string[] = [];
  lines.push(`${file}`);
  lines.push(`  容器 ${(j.format?.format_name ?? "?").split(",")[0]}｜${((j.format?.size ?? 0) / 1024 / 1024).toFixed(1)} MB｜${Number(j.format?.duration ?? 0).toFixed(0)}s`);
  const vInfo = video.map((s) => `${s.codec_name}${s.disposition?.default ? "(默认)" : ""}`).join(" + ") || "无";
  const aInfo = audio.map((s) => `${s.codec_name}${s.tags?.language ? `.${s.tags.language}` : ""}`).join(" + ") || "无";
  lines.push(`  流：视频 ${vInfo}｜音频 ${aInfo}｜字幕 ${subs.length}｜数据/附件 ${data.length}`);
  const copyable: string[] = [];
  const caveats: string[] = [];
  if (video.length === 1 && ["h264", "hevc", "vp9", "av1"].includes(video[0]!.codec_name ?? ""))
    copyable.push(`视频 ${video[0]!.codec_name} 可直接 copy`);
  else if (video.length > 1) caveats.push(`多视频流（${video.length}），remux 需先选定主轨`);
  else caveats.push(`视频编码 ${video[0]?.codec_name ?? "?"} 目标容器可能不收，或需转码`);
  if (audio.length === 0) caveats.push("无音轨（动图常态，remux 无碍）");
  else if (audio.length >= 1 && audio.every((s) => ["aac", "mp3", "ac3", "eac3", "opus", "flac"].includes(s.codec_name ?? "")))
    copyable.push(`音频 ${audio.map((s) => s.codec_name).join("/")} 可直接 copy`);
  else caveats.push("存在非常规音频编码，copy 前确认目标容器兼容");
  if (subs.length) caveats.push(`${subs.length} 条字幕流：mp4 只收 mov_text，mkv/webm 才能带原生字幕`);
  if (data.length) caveats.push(`${data.length} 条数据/附件流（时间码/封面等），remux 时通常可丢`);
  lines.push(`  判读：${copyable.join("；") || "需评估"}${caveats.length ? `；注意 ${caveats.join("；")}` : "，可直接无损重封装"}`);
  console.log(lines.join("\n"));
  return { ok: true, note: "" };
}

function main(): number {
  const files = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  if (!files.length) {
    console.error("用法：remux-probe.ts <media-file> [more...]（ffprobe 只读探测）");
    return 2;
  }
  const has = spawnSync("ffprobe", ["-version"], { timeout: 10_000 }).status;
  if (has !== 0) {
    console.error("ffprobe 不可用（brew install ffmpeg）");
    return 1;
  }
  let fail = 0;
  for (const f of files) {
    const r = probe(f);
    if (!r.ok) {
      fail++;
      console.log(`${f}\n  ✗ ${r.note}`);
    }
  }
  return fail ? 2 : 0;
}

process.exit(main());
