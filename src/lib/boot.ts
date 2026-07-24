/**
 * 启动屏编排（Web Animations API）
 *
 * 职责分层：
 * - PureCSS（app.html）：仅负责启动屏常驻的 blur 呼吸光影。
 * - 本模块：负责退场（启动屏 blurOut + 淡出）与进场（主体 blurIn + 淡入）。
 *
 * 时序契约：
 *   启动屏盖在主体之上（z-index 9999）。SPA ready 时并行触发：
 *     dismissBoot()  ── 启动屏 blur 扩散 + opacity→0
 *     animateAppIn() ── 主体 blur 收束 + opacity 0→1
 *   两者同速同时长，视觉上主体「从模糊中浮现」替代启动屏。
 *
 * 正交意图：
 * 1. dismissBoot：启动屏退场（用户需求 2026-07-23）
 * 2. animateAppIn：主体进场（用户需求 2026-07-23）
 */

const DURATION = 400;
const EASE = "cubic-bezier(0.22, 0.61, 0.36, 1)";

/**
 * 启动屏退场：blur 从 0 扩散到 24px，轻微放大，opacity 同步淡出。
 * 退场结束后移除 DOM。
 */
export function dismissBoot(): void {
  const boot = document.getElementById("gaubee-boot");
  if (!boot) return;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduceMotion) {
    boot.remove();
    return;
  }

  // 停止 PureCSS 的呼吸动画，避免与退场动画冲突
  const logo = boot.querySelector(".boot-logo") as HTMLElement | null;
  logo?.getAnimations().forEach((a) => a.cancel());

  const anim = boot.animate(
    [
      { filter: "blur(0px)", transform: "scale(1)", opacity: 1 },
      { filter: "blur(24px)", transform: "scale(1.1)", opacity: 0 },
    ],
    { duration: DURATION, easing: EASE, fill: "forwards" },
  );
  anim.onfinish = () => boot.remove();
}

/**
 * 主体进场：blur 从 12px 收束到 0，opacity 从 0 淡入到 1。
 * 与 dismissBoot 并行，形成「主体从模糊中浮现」的过渡。
 */
export function animateAppIn(): void {
  const app = document.querySelector<HTMLElement>(".app-layout");
  if (!app) return;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduceMotion) return;

  app.animate(
    [
      { filter: "blur(12px)", opacity: 0 },
      { filter: "blur(0px)", opacity: 1 },
    ],
    { duration: DURATION, easing: EASE, fill: "forwards" },
  );
}
