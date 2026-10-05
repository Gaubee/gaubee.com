/**
 * x-video.ts — X 归档视频播放增强（Svelte action，零依赖 vanilla DOM）。
 *
 * 文件意图（正交意图清单）：
 * - [2026-10-05] kzf：视频播放组件封装——自动播放、全局同时只播一个、快速静音、
 *   自动播放/静音带记忆（浏览器限制下静音自动兜底）；单手手势控制：
 *   右侧上下滑=音量，长按=2 倍速，左右滑=拖进度，双击左/右=退/进 10s，
 *   连续点击按 (次数-1)×10s 累计（两次 10s、三次 20s…），单击=播放/暂停。
 * - 用法：`use:xvideo` 挂在内容容器上，扫描容器内全部 <video>（含 markdown 注入的）。
 * - 精确指针（桌面）：保留原生 controls，仅启用自动播放/单实例/静音记忆。
 *   粗指针（触屏）：收起原生 controls，启用手势层 + 自绘进度/音量 HUD。
 */

const MUTE_KEY = "xvideo:muted";

/** 全局同时只播一个。 */
let current: HTMLVideoElement | null = null;

function mutedPref(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) !== "0"; // 默认静音（自动播放策略友好）
  } catch {
    return true;
  }
}

function saveMutedPref(muted: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    /* 无痕模式忽略 */
  }
}

/** 播放：先按记忆的静音偏好尝试；被浏览器拒绝则静音兜底重试。 */
function playVideo(video: HTMLVideoElement): void {
  if (current && current !== video) {
    current.pause();
  }
  video.muted = mutedPref();
  const p = video.play();
  if (p) {
    p.catch(() => {
      if (video.muted) return; // 静音都被拒（极端策略），放弃
      video.muted = true; // 声音自动播放被拒 → 静音兜底（记忆保留，手动解除后仍会记住）
      video.play().catch(() => {});
    });
  }
  current = video;
}

interface Hud {
  root: HTMLDivElement;
  text: HTMLDivElement;
  bar: HTMLDivElement;
  barFill: HTMLDivElement;
  hideTimer: number | undefined;
}

function flashHud(hud: Hud, text: string): void {
  hud.text.textContent = text;
  hud.text.style.opacity = "1";
  window.clearTimeout(hud.hideTimer);
  hud.hideTimer = window.setTimeout(() => {
    hud.text.style.opacity = "0";
  }, 700);
}

/** 触屏手势 + HUD（每视频一套）。返回清理函数。 */
function enhanceTouch(video: HTMLVideoElement): () => void {
  const wrap = document.createElement("div");
  wrap.className = "xv-wrap";
  video.parentNode!.insertBefore(wrap, video);
  wrap.appendChild(video);

  const hud: Hud = {
    root: document.createElement("div"),
    text: document.createElement("div"),
    bar: document.createElement("div"),
    barFill: document.createElement("div"),
    hideTimer: undefined,
  };
  hud.root.className = "xv-hud";
  hud.text.className = "xv-hud-text";
  hud.bar.className = "xv-bar";
  hud.barFill.className = "xv-bar-fill";
  hud.bar.appendChild(hud.barFill);

  const muteBtn = document.createElement("button");
  muteBtn.type = "button";
  muteBtn.className = "xv-mute";
  const syncMuteBtn = () => (muteBtn.textContent = video.muted ? "🔇" : "🔊");
  syncMuteBtn();
  muteBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    video.muted = !video.muted;
    saveMutedPref(video.muted);
    syncMuteBtn();
  });

  hud.root.appendChild(hud.text);
  hud.root.appendChild(muteBtn);
  hud.root.appendChild(hud.bar);
  wrap.appendChild(hud.root);

  video.removeAttribute("controls");
  // 元数据前置（kzf 裁决 16）：生成器把时长挂在 data-duration，布局与进度条即刻可用
  const hintedDuration = Number(video.dataset.duration ?? 0);
  if (hintedDuration > 0) {
    hud.barFill.style.width = `${video.currentTime > 0 ? (video.currentTime / hintedDuration) * 100 : 0}%`;
  }
  video.addEventListener("timeupdate", () => {
    if (video.duration > 0) hud.barFill.style.width = `${(video.currentTime / video.duration) * 100}%`;
  });

  // --- 手势状态机 ---
  let sx = 0;
  let sy = 0;
  let baseTime = 0;
  let baseVolume = 1;
  let side: "left" | "right" = "left";
  let mode: "" | "seek" | "volume" = "";
  let moved = false;
  let downAt = 0;
  let longTimer: number | undefined;
  let taps = 0;
  let tapSide: "left" | "right" = "left";
  let tapTimer: number | undefined;

  const clearLong = () => {
    if (longTimer !== undefined) {
      window.clearTimeout(longTimer);
      longTimer = undefined;
    }
  };
  const setRate = (r: number) => {
    video.playbackRate = r;
    if (r !== 1) flashHud(hud, `${r}x 倍速`);
  };

  const onDown = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest(".xv-mute")) return;
    sx = e.clientX;
    sy = e.clientY;
    baseTime = video.currentTime;
    baseVolume = video.muted ? 0.5 : video.volume;
    side = sx - wrap.getBoundingClientRect().left < wrap.clientWidth / 2 ? "left" : "right";
    mode = "";
    moved = false;
    downAt = Date.now();
    clearLong();
    longTimer = window.setTimeout(() => setRate(2), 500);
    wrap.setPointerCapture?.(e.pointerId);
  };

  const onMove = (e: PointerEvent) => {
    const dx = e.clientX - sx;
    const dy = e.clientY - sy;
    if (!mode) {
      if (Math.abs(dx) < 12 && Math.abs(dy) < 12) return;
      clearLong();
      setRate(1);
      moved = true;
      mode = Math.abs(dx) > Math.abs(dy) ? "seek" : side === "right" ? "volume" : "";
      if (!mode) return;
    }
    if (mode === "seek" && video.duration > 0) {
      const delta = (dx / wrap.clientWidth) * video.duration;
      const next = Math.min(Math.max(baseTime + delta, 0), video.duration - 0.1);
      video.currentTime = next;
      flashHud(hud, `${fmt(next)} / ${fmt(video.duration)}`);
    } else if (mode === "volume") {
      const vol = Math.min(Math.max(baseVolume - dy / wrap.clientHeight, 0), 1);
      video.volume = vol;
      video.muted = vol === 0;
      saveMutedPref(video.muted);
      syncMuteBtn();
      flashHud(hud, `音量 ${Math.round(vol * 100)}%`);
    }
  };

  const onUp = () => {
    clearLong();
    if (video.playbackRate !== 1) setRate(1);
    const tap = !moved && Date.now() - downAt < 500;
    if (tap) {
      if (taps > 0 && side === tapSide) {
        // 连击累计：两次 10s、三次 20s…（单击的播放/暂停定时器作废）
        window.clearTimeout(tapTimer);
        tapTimer = undefined;
        taps += 1;
        const sec = 10 * (taps - 1);
        video.currentTime = Math.min(Math.max(video.currentTime + (side === "left" ? -sec : sec), 0), video.duration || video.currentTime);
        flashHud(hud, `${side === "left" ? "⏪" : "⏩"} ${sec}s`);
      } else {
        taps = 1;
        tapSide = side;
        window.clearTimeout(tapTimer);
        tapTimer = window.setTimeout(() => {
          taps = 0;
          tapTimer = undefined;
          if (video.paused) playVideo(video);
          else video.pause();
        }, 320);
      }
    }
    mode = "";
  };

  wrap.addEventListener("pointerdown", onDown);
  wrap.addEventListener("pointermove", onMove);
  wrap.addEventListener("pointerup", onUp);
  wrap.addEventListener("pointercancel", onUp);

  return () => {
    wrap.removeEventListener("pointerdown", onDown);
    wrap.removeEventListener("pointermove", onMove);
    wrap.removeEventListener("pointerup", onUp);
    wrap.removeEventListener("pointercancel", onUp);
    video.parentNode?.insertBefore(video, wrap);
    wrap.remove();
  };
}

function fmt(sec: number): string {
  const s = Math.floor(sec % 60);
  const m = Math.floor(sec / 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function xvideo(node: HTMLElement): { destroy: () => void } {
  const cleanups: (() => void)[] = [];
  const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const video = entry.target as HTMLVideoElement;
        if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
          playVideo(video);
        } else if (!entry.isIntersecting && video === current) {
          video.pause();
          current = null;
        }
      }
    },
    { threshold: [0, 0.6, 1] },
  );

  const enhanced = new WeakSet<HTMLVideoElement>();
  function enhance(video: HTMLVideoElement): void {
    if (enhanced.has(video)) return;
    enhanced.add(video);
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    if (coarse) {
      cleanups.push(enhanceTouch(video));
    } else {
      video.controls = true; // 桌面保留原生控制条
    }
    io.observe(video);
  }

  // 首扫：详情页（SSG HTML）此刻就有 video；列表页（MarkdownViewer 在 $effect 里
  // 渲染 HTML）此刻还没有——用 MutationObserver 等它们出现后再增强。
  node.querySelectorAll("video").forEach(enhance);
  const mo = new MutationObserver(() => {
    node.querySelectorAll("video").forEach(enhance);
  });
  mo.observe(node, { childList: true, subtree: true });

  return {
    destroy() {
      mo.disconnect();
      io.disconnect();
      for (const fn of cleanups) fn();
    },
  };
}
