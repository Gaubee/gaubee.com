/**
 * ThemeService：主题色相能力（GaubeeOS 应用服务总线的一部分）。
 *
 * 管理运行时 primary 色相（--primary-h），驱动 app.css 中所有橙红系变量的计算式派生。
 * 亮度/彩度由 CSS 字面量锁定（可访问性保证），用户只能旋转色相。
 *
 * 正交意图：
 * 1. 原始需求（2026-07-24）：自定义 primary color，但必须保持与默认色一致的亮度。
 *
 * 设计：
 * - hue 用 $state，组件响应式订阅（ThemeView 滑块实时预览）。
 * - setHue 即时注入 documentElement.style.setProperty('--primary-h', ...)，
 *   app.css 的 calc 计算式自动重算所有派生色，全 OS 即时换色。
 * - 构造时从 localStorage 恢复，确保刷新后主题不丢。
 * - 与 mode-watcher 正交：mode-watcher 管 light/dark，本 service 管色相。
 */
import { browser } from "$app/environment";
import type { AppService } from "$lib/os/services";

/** 默认色相（与 app.css :root 的 --primary-h 初始值一致，橙红）。 */
export const DEFAULT_PRIMARY_HUE = 16.935;

/** localStorage key。 */
const STORAGE_KEY = "gaubee:os:theme";

/** 主题服务接口。 */
export interface ThemeService extends AppService {
  readonly id: "theme";
  readonly appId: "theme";
  /** 当前 primary 色相（0-360）。默认 DEFAULT_PRIMARY_HUE。 */
  readonly hue: number;
  /** 设置色相（自动归一化到 0-360），即时注入 --primary-h 并持久化。 */
  setHue(hue: number): void;
  /** 重置为默认色相。 */
  reset(): void;
}

/** 归一化色相到 [0, 360)。 */
function normalizeHue(hue: number): number {
  return ((hue % 360) + 360) % 360;
}

class ThemeServiceImpl implements ThemeService {
  readonly id = "theme" as const;
  readonly appId = "theme" as const;

  hue = $state(DEFAULT_PRIMARY_HUE);

  constructor() {
    if (browser) {
      this.restore();
    }
  }

  setHue(hue: number): void {
    const normalized = normalizeHue(hue);
    this.hue = normalized;
    this.applyToDom(normalized);
    this.persist();
  }

  reset(): void {
    this.setHue(DEFAULT_PRIMARY_HUE);
  }

  /** 注入 --primary-h 到 documentElement（驱动 app.css 计算式）。 */
  private applyToDom(hue: number): void {
    if (!browser) return;
    document.documentElement.style.setProperty("--primary-h", String(hue));
  }

  private persist(): void {
    if (!browser) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ hue: this.hue }));
    } catch {
      // 存储不可用，忽略
    }
  }

  private restore(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (
        parsed !== null &&
        typeof parsed === "object" &&
        typeof (parsed as { hue?: unknown }).hue === "number"
      ) {
        const hue = normalizeHue((parsed as { hue: number }).hue);
        this.hue = hue;
        this.applyToDom(hue);
      }
    } catch {
      // 损坏数据，忽略
    }
  }
}

/** 主题服务单例。 */
export const themeService: ThemeService = new ThemeServiceImpl();
