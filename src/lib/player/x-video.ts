/**
 * x-video.ts — X 归档视频播放增强（Svelte action，零依赖 vanilla DOM，样式自注入）。
 *
 * 文件意图（正交意图清单）：
 * - [2026-10-05] kzf：视频播放组件封装——自动播放、全局同时只播一个、快速静音、
 *   自动播放/静音带记忆（浏览器限制下静音自动兜底）；单手手势控制（触屏）：
 *   右侧上下滑=音量，长按=2 倍速，左右滑=拖进度，双击左/右=退/进 10s，
 *   连续点击按 (次数-1)×10s 累计（两次 10s、三次 20s…），单击=播放/暂停。
 * - [2026-10-18] kzf：定制播放器控件，体验对齐 X 播放器——两端统一自绘 chrome
 *   （桌面不再用原生 controls）：底部渐变控制条 = 细进度条（hover 变粗 + 圆形把手 +
 *   buffered 段）+ 控制行（静音按钮 desktop hover 展开音量条 / 时间 m:ss / 全屏）；
 *   单击播放/暂停 + 中心圆形图标闪现；桌面双击全屏；播放中空闲 2.5s 控件淡出 +
 *   光标隐藏；视频循环（X 时间线语义）；键盘（focus 时）空格/←→/m/f。
 *   触屏手势层原样保留，叠放在 chrome 之下（chrome 交互不进手势机）。
 * - 纯逻辑（时间格式/连击秒数/拖拽钳制）抽在 x-video-core.ts（node 可测）。
 * - 用法：`use:xvideo` 挂在内容容器上，扫描容器内全部 <video>（含 markdown 注入的）。
 */

import { clampSeek, fmt, fraction, seekSeconds, volumeFromDrag } from "./x-video-core";

const MUTE_KEY = "xvideo:muted";

/** 全局同时只播一个。 */
let current: HTMLVideoElement | null = null;

/** 控件空闲自动隐藏阈值（X 约 2.5s）。 */
const HIDE_DELAY_MS = 2500;
/** 桌面单击/双击消歧窗口。 */
const CLICK_DISAMBIG_MS = 260;
/** 触屏单击/双击消歧窗口（旧版 320ms，保留）。 */
const TAP_DISAMBIG_MS = 320;

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

// ---- 图标（lucide 路径，与站点图标体系同源；播放/暂停用实心贴近 X 形态）----
const svg = (body: string, filled = false) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" ${
    filled
      ? 'fill="currentColor" stroke="none"'
      : 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'
  }>${body}</svg>`;
const ICON = {
  play: svg('<polygon points="7 4 20 12 7 20 7 4"/>', true),
  pause: svg('<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>', true),
  volumeX: svg(
    '<polygon points="11 5 6 9 3 9 3 15 6 15 11 19 11 5"/><line x1="22" y1="2" x2="2" y2="22"/>',
  ),
  volume2: svg(
    '<polygon points="11 5 6 9 3 9 3 15 6 15 11 19 11 5"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>',
  ),
  maximize: svg(
    '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
  ),
  minimize: svg(
    '<path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/>',
  ),
};

// ---- 样式自注入（action 自包含：markdown 注入的 video 也能拿到 chrome）----
const STYLE_ID = "xv-style";
function ensureStyles(): void {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = `
.xv-wrap{position:relative;overflow:hidden;border-radius:12px;background:#141416;outline:none;max-width:100%}
.xv-wrap.xv-ratio video{width:100%;height:100%;object-fit:contain}
.xv-wrap:fullscreen{border-radius:0}
.xv-wrap:fullscreen video{width:100%;height:100%;object-fit:contain}
.xv-wrap video{display:block;width:100%}
.xv-badge{position:absolute;left:10px;bottom:10px;z-index:1;display:flex;align-items:center;gap:5px;background:rgba(0,0,0,.7);color:#fff;border-radius:5px;padding:4px 9px 4px 7px;font-size:12px;line-height:1;font-variant-numeric:tabular-nums;pointer-events:none;transition:opacity .2s}
.xv-badge svg{width:11px;height:11px}
.xv-wrap.xv-controls-hidden{cursor:none}
.xv-bar{position:absolute;left:0;right:0;bottom:0;z-index:2;padding:22px 12px 4px;background:linear-gradient(transparent,rgba(0,0,0,.55) 55%,rgba(0,0,0,.8));opacity:1;transition:opacity .22s;touch-action:none}
.xv-bar.xv-hidden{opacity:0;pointer-events:none}
.xv-progress{position:relative;height:3px;margin:0 6px 3px;border-radius:2px;background:rgba(255,255,255,.22);cursor:pointer;transition:height .12s}
.xv-progress:hover,.xv-progress.xv-dragging{height:6px}
.xv-buffer{position:absolute;top:0;bottom:0;left:0;width:0;background:rgba(255,255,255,.14);border-radius:2px}
.xv-fill{position:absolute;top:0;bottom:0;left:0;width:0;background:#fff;border-radius:2px}
.xv-handle{position:absolute;top:50%;left:0;width:12px;height:12px;border-radius:50%;background:#fff;transform:translate(-50%,-50%);opacity:0;transition:opacity .12s;box-shadow:0 0 4px rgba(0,0,0,.5)}
.xv-progress:hover .xv-handle,.xv-progress.xv-dragging .xv-handle{opacity:1}
.xv-controls{display:flex;align-items:center;gap:2px;margin-top:2px}
.xv-btn{appearance:none;border:0;background:transparent;color:#fff;width:34px;height:30px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;border-radius:6px;padding:0}
.xv-btn:hover{background:rgba(255,255,255,.16)}
.xv-btn svg{width:18px;height:18px}
.xv-time{color:#fff;font-size:13px;font-variant-numeric:tabular-nums;text-shadow:0 1px 2px rgba(0,0,0,.6);white-space:nowrap;margin:0 4px 0 6px;user-select:none}
.xv-time .xv-dur{color:rgba(255,255,255,.7)}
.xv-volume{width:0;opacity:0;height:3px;accent-color:#fff;cursor:pointer;transition:width .15s,opacity .15s;margin:0;padding:0}
@media (hover:hover){.xv-mute:hover+.xv-volume,.xv-volume:hover{width:64px;opacity:1;margin-right:6px}}
.xv-spacer{flex:1}
.xv-center{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;z-index:1}
.xv-center span{width:56px;height:56px;border-radius:50%;background:rgba(15,15,15,.55);display:flex;align-items:center;justify-content:center;opacity:0}
.xv-center span svg{width:24px;height:24px}
.xv-center.xv-pop span{animation:xv-pop .5s ease-out forwards}
@keyframes xv-pop{0%{opacity:1;transform:scale(1)}100%{opacity:0;transform:scale(1.35)}}
.xv-flash{position:absolute;left:50%;top:34%;transform:translateX(-50%);z-index:1;pointer-events:none;color:#fff;font-size:13px;background:rgba(15,15,15,.55);padding:6px 12px;border-radius:16px;opacity:0;transition:opacity .25s;white-space:nowrap}
@media (prefers-reduced-motion:reduce){.xv-center.xv-pop span{animation:none;opacity:0}}
`;
  document.head.appendChild(el);
}

/** 中心图标闪现（播放/暂停反馈，X 形态）。 */
function createCenterFlash(wrap: HTMLDivElement) {
  const center = document.createElement("div");
  center.className = "xv-center";
  const disc = document.createElement("span");
  center.appendChild(disc);
  wrap.appendChild(center);
  let timer: number | undefined;
  return {
    pop(icon: string): void {
      disc.innerHTML = icon;
      center.classList.remove("xv-pop");
      void center.offsetWidth; // 强制 reflow 重触发 CSS 动画
      center.classList.add("xv-pop");
      window.clearTimeout(timer);
      timer = window.setTimeout(() => center.classList.remove("xv-pop"), 550);
    },
    destroy(): void {
      window.clearTimeout(timer);
    },
  };
}

/** 手势 HUD 闪现文本（⏪ 10s / 音量 60% / 2x 倍速）。 */
function createFlashText(wrap: HTMLDivElement) {
  const el = document.createElement("div");
  el.className = "xv-flash";
  wrap.appendChild(el);
  let timer: number | undefined;
  return {
    flash(text: string): void {
      el.textContent = text;
      el.style.opacity = "1";
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        el.style.opacity = "0";
      }, 700);
    },
    destroy(): void {
      window.clearTimeout(timer);
    },
  };
}

interface Bar {
  root: HTMLDivElement;
  progress: HTMLDivElement;
  syncMute(): void;
  syncTime(): void;
  show(): void;
  armHide(): void;
  cancelHide(): void;
  toggleFullscreen(): void;
  destroy(): void;
}

/** 底部控制条（进度 + 静音/音量 + 时间 + 全屏）与可见性状态机。badge=封面角标（静置态显示）。 */
function createBar(video: HTMLVideoElement, wrap: HTMLDivElement, coarse: boolean, badge?: HTMLDivElement): Bar {
  const root = document.createElement("div");
  root.className = "xv-bar";

  const progress = document.createElement("div");
  progress.className = "xv-progress";
  const buffer = document.createElement("div");
  buffer.className = "xv-buffer";
  const fill = document.createElement("div");
  fill.className = "xv-fill";
  const handle = document.createElement("div");
  handle.className = "xv-handle";
  progress.append(buffer, fill, handle);

  const controls = document.createElement("div");
  controls.className = "xv-controls";
  const muteBtn = document.createElement("button");
  muteBtn.type = "button";
  muteBtn.className = "xv-btn xv-mute";
  const volume = document.createElement("input");
  volume.type = "range";
  volume.className = "xv-volume";
  volume.min = "0";
  volume.max = "1";
  volume.step = "0.05";
  if (coarse) volume.style.display = "none"; // 触屏音量走滑动手势
  const time = document.createElement("div");
  time.className = "xv-time";
  const spacer = document.createElement("div");
  spacer.className = "xv-spacer";
  const fsBtn = document.createElement("button");
  fsBtn.type = "button";
  fsBtn.className = "xv-btn xv-fs";
  controls.append(muteBtn, volume, time, spacer, fsBtn);

  root.append(progress, controls);
  wrap.appendChild(root);

  // ---- 可见性状态机（X 语义）----
  // 静置（从未播放）：条隐藏、角标显示（X 卡片形态）；hover/触摸 → 条现、角标隐；
  // 播放中：空闲 HIDE_DELAY 后条淡出 + 光标隐藏；暂停 → 条常显（角标不再回来）。
  let started = false;
  let hideTimer: number | undefined;
  const clearHide = () => {
    if (hideTimer !== undefined) {
      window.clearTimeout(hideTimer);
      hideTimer = undefined;
    }
  };
  const syncBadge = () => {
    if (badge && !started) badge.style.opacity = root.classList.contains("xv-hidden") ? "1" : "0";
  };
  const armHide = () => {
    clearHide();
    hideTimer = window.setTimeout(() => {
      root.classList.add("xv-hidden");
      wrap.classList.add("xv-controls-hidden");
      syncBadge();
    }, HIDE_DELAY_MS);
  };
  const show = () => {
    clearHide();
    root.classList.remove("xv-hidden");
    wrap.classList.remove("xv-controls-hidden");
    syncBadge();
    if (!video.paused) armHide();
  };
  /** 回到静置态（条隐藏、角标回来、光标正常）——仅未开播时。 */
  const rest = () => {
    clearHide();
    if (started) return;
    root.classList.add("xv-hidden");
    wrap.classList.remove("xv-controls-hidden");
    syncBadge();
  };
  video.addEventListener(
    "play",
    () => {
      started = true;
      badge?.remove();
    },
    { once: true },
  );

  // ---- 同步器 ----
  const duration = () => video.duration || Number(video.dataset.duration ?? 0) || 0;
  const syncMute = () => {
    muteBtn.innerHTML = video.muted ? ICON.volumeX : ICON.volume2;
    volume.value = String(video.muted ? 0 : video.volume);
  };
  const syncTime = () => {
    const f = fraction(video.currentTime, duration()) * 100;
    fill.style.width = `${f}%`;
    handle.style.left = `${f}%`;
    time.innerHTML = `${fmt(video.currentTime)} <span class="xv-dur">/ ${fmt(duration())}</span>`;
  };
  const syncBuffer = () => {
    const b = video.buffered;
    if (b && b.length > 0 && video.duration > 0) {
      buffer.style.width = `${fraction(b.end(b.length - 1), video.duration) * 100}%`;
    }
  };

  video.addEventListener("timeupdate", syncTime);
  video.addEventListener("progress", syncBuffer);
  video.addEventListener("loadedmetadata", syncTime);
  video.addEventListener("volumechange", syncMute);
  video.addEventListener("play", armHide);
  video.addEventListener("pause", show);
  wrap.addEventListener("pointermove", show);

  // ---- 静音/音量 ----
  muteBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    video.muted = !video.muted;
    if (!video.muted && video.volume === 0) video.volume = 0.5;
    saveMutedPref(video.muted);
  });
  volume.addEventListener("input", () => {
    video.volume = Number(volume.value);
    video.muted = video.volume === 0;
    saveMutedPref(video.muted);
  });
  // chrome 上的指针按下不进 wrap 的点击/手势（拖音量条、点时间都不该切播放）
  root.addEventListener("pointerdown", (e) => e.stopPropagation());

  // ---- 全屏（iOS Safari 无元素全屏 → video.webkitEnterFullscreen 兜底）----
  const isFs = () => document.fullscreenElement === wrap;
  const syncFs = () => {
    fsBtn.innerHTML = isFs() ? ICON.minimize : ICON.maximize;
  };
  const toggleFullscreen = () => {
    if (isFs()) {
      void document.exitFullscreen();
    } else if (wrap.requestFullscreen) {
      void wrap.requestFullscreen();
    } else {
      (video as HTMLVideoElement & { webkitEnterFullscreen?: () => void }).webkitEnterFullscreen?.();
    }
  };
  fsBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleFullscreen();
  });
  document.addEventListener("fullscreenchange", syncFs);
  syncFs();

  // ---- 进度条拖拽定位（两端都可拖；触屏另有滑动手势并存）----
  const seekFromPointer = (clientX: number) => {
    const rect = progress.getBoundingClientRect();
    const ratio = rect.width > 0 ? Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1) : 0;
    video.currentTime = ratio * duration();
    syncTime();
  };
  progress.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    progress.classList.add("xv-dragging");
    progress.setPointerCapture?.(e.pointerId);
    seekFromPointer(e.clientX);
  });
  progress.addEventListener("pointermove", (e) => {
    if (progress.classList.contains("xv-dragging")) seekFromPointer(e.clientX);
  });
  const endDrag = (e: PointerEvent) => {
    if (!progress.classList.contains("xv-dragging")) return;
    progress.classList.remove("xv-dragging");
    progress.releasePointerCapture?.(e.pointerId);
  };
  progress.addEventListener("pointerup", endDrag);
  progress.addEventListener("pointercancel", endDrag);

  // 桌面：指针悬停在 chrome 上时不自动隐藏（调音量/拖进度中途不消失）；离开视频回静置态
  if (!coarse) {
    root.addEventListener("pointerenter", () => clearHide());
    root.addEventListener("pointerleave", () => {
      if (!video.paused) armHide();
    });
    wrap.addEventListener("pointerleave", () => {
      if (video.paused) rest();
    });
  }

  syncMute();
  syncTime();
  rest(); // 初始为静置态（X 卡片形态：封面+角标，无控制条）
  return {
    root,
    progress,
    syncMute,
    syncTime,
    show,
    armHide,
    cancelHide: clearHide,
    toggleFullscreen,
    destroy() {
      clearHide();
      document.removeEventListener("fullscreenchange", syncFs);
    },
  };
}

interface VideoEnhance {
  togglePlay(): void;
}

/** 触屏手势层（kzf 2026-10-05 裁决原样保留；chrome 交互不进手势机）。 */
function attachGestures(video: HTMLVideoElement, wrap: HTMLDivElement, flash: (text: string) => void): () => void {
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
    if (r !== 1) flash(`${r}x 倍速`);
  };

  const onDown = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest(".xv-bar")) return; // chrome 交互不进手势机
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
    if (!downAt) return;
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
      video.currentTime = clampSeek(baseTime, delta, video.duration);
      flash(`${fmt(video.currentTime)} / ${fmt(video.duration)}`);
    } else if (mode === "volume") {
      const vol = volumeFromDrag(baseVolume, dy, wrap.clientHeight);
      video.volume = vol;
      video.muted = vol === 0;
      saveMutedPref(video.muted);
      flash(`音量 ${Math.round(vol * 100)}%`);
    }
  };

  const onUp = (e: PointerEvent) => {
    if (!downAt) return;
    const held = Date.now() - downAt;
    downAt = 0;
    void e;
    clearLong();
    if (video.playbackRate !== 1) setRate(1);
    if (!moved && held < 500) {
      if (taps > 0 && side === tapSide) {
        // 连击累计：两次 10s、三次 20s…（单击的播放/暂停定时器作废）
        window.clearTimeout(tapTimer);
        tapTimer = undefined;
        taps += 1;
        const sec = seekSeconds(taps);
        video.currentTime = clampSeek(video.currentTime, side === "left" ? -sec : sec, video.duration || video.currentTime);
        flash(`${side === "left" ? "⏪" : "⏩"} ${sec}s`);
      } else {
        taps = 1;
        tapSide = side;
        window.clearTimeout(tapTimer);
        tapTimer = window.setTimeout(() => {
          taps = 0;
          tapTimer = undefined;
          if (video.paused) playVideo(video);
          else video.pause();
        }, TAP_DISAMBIG_MS);
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
    window.clearTimeout(longTimer);
    window.clearTimeout(tapTimer);
  };
}

/** 桌面指针层：单击播放/暂停（中心图标闪现）、双击全屏（X 语义）、键盘控制。 */
function attachFine(video: HTMLVideoElement, wrap: HTMLDivElement, enhance: VideoEnhance, bar: Bar): () => void {
  let clickTimer: number | undefined;

  const onKeyUp = (e: KeyboardEvent) => {
    switch (e.key) {
      case " ":
      case "k":
        e.preventDefault();
        enhance.togglePlay();
        break;
      case "ArrowLeft":
        e.preventDefault();
        video.currentTime = clampSeek(video.currentTime, -5, video.duration || video.currentTime);
        bar.show();
        break;
      case "ArrowRight":
        e.preventDefault();
        video.currentTime = clampSeek(video.currentTime, 5, video.duration || video.currentTime);
        bar.show();
        break;
      case "m":
        video.muted = !video.muted;
        if (!video.muted && video.volume === 0) video.volume = 0.5;
        saveMutedPref(video.muted);
        break;
      case "f":
        bar.toggleFullscreen();
        break;
    }
  };

  const onClick = () => {
    // 单击延迟消歧：等双击窗口过去才切播放（双击 = 全屏，X 语义）
    window.clearTimeout(clickTimer);
    clickTimer = window.setTimeout(() => enhance.togglePlay(), CLICK_DISAMBIG_MS);
  };
  const onDblClick = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest(".xv-bar")) return;
    window.clearTimeout(clickTimer);
    bar.toggleFullscreen();
  };

  wrap.addEventListener("click", onClick);
  wrap.addEventListener("dblclick", onDblClick);
  wrap.addEventListener("keyup", onKeyUp);
  return () => {
    window.clearTimeout(clickTimer);
    wrap.removeEventListener("click", onClick);
    wrap.removeEventListener("dblclick", onDblClick);
    wrap.removeEventListener("keyup", onKeyUp);
  };
}

/** 单视频增强：wrap 包裹 + chrome + 端别交互层。返回整体清理函数。 */
function enhanceVideo(video: HTMLVideoElement, coarse: boolean): () => void {
  ensureStyles();
  const wrap = document.createElement("div");
  wrap.className = "xv-wrap";
  wrap.tabIndex = 0; // 键盘可聚焦（空格/←→/m/f）
  video.parentNode!.insertBefore(wrap, video);
  wrap.appendChild(video);

  video.removeAttribute("controls");
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  video.loop = true; // X 时间线语义：循环播放

  // 初始化布局稳定（kzf 2026-10-18）：生成器带 width/height/poster/data-duration——
  // preload="none" 下元数据不可用，按属性预留 aspect-ratio，封面即首帧布局，零跳动
  const w = Number(video.getAttribute("width")) || 0;
  const h = Number(video.getAttribute("height")) || 0;
  if (w > 0 && h > 0) {
    wrap.style.aspectRatio = `${w} / ${h}`;
    wrap.classList.add("xv-ratio");
  }

  // X 封面角标：播放键 + 时长（静置态显示，开播即移除）
  const hintedDuration = Number(video.dataset.duration ?? 0);
  let badge: HTMLDivElement | undefined;
  if (hintedDuration > 0) {
    badge = document.createElement("div");
    badge.className = "xv-badge";
    badge.innerHTML = `${svg('<polygon points="6 4 20 12 6 20 6 4"/>', true)}<span>${fmt(hintedDuration)}</span>`;
    wrap.appendChild(badge);
  }
  const bar = createBar(video, wrap, coarse, badge);

  const flashText = createFlashText(wrap);
  const centerFlash = createCenterFlash(wrap);

  const enhance: VideoEnhance = {
    togglePlay() {
      if (video.paused) {
        playVideo(video);
        centerFlash.pop(ICON.play);
      } else {
        video.pause();
        centerFlash.pop(ICON.pause);
      }
      bar.show();
    },
  };

  const cleanups: (() => void)[] = [];
  cleanups.push(coarse ? attachGestures(video, wrap, (t) => flashText.flash(t)) : attachFine(video, wrap, enhance, bar));
  cleanups.push(() => {
    bar.destroy();
    centerFlash.destroy();
    flashText.destroy();
    // 还原用 replaceWith：video.parentNode === wrap（视频在 wrap 内），旧写法
    // video.parentNode.insertBefore(video, wrap) = wrap.insertBefore(video, wrap)，
    // 参照节点是自身必然抛 NotFoundError——SPA 内分支卸载（事件工作区内嵌详情收起）
    // 时该异常会中断 Svelte effect 刷新，冻结同组件后续模板更新（2026-10-09 实证）。
    wrap.replaceWith(video);
  });
  return () => {
    for (const fn of cleanups) fn();
  };
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
    cleanups.push(enhanceVideo(video, coarse));
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
