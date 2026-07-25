/**
 * DesktopService：桌面背景能力（GaubeeOS 应用服务总线的一部分）。
 *
 * 管理桌面背景配置（默认/纯色/渐变/图片/SVG 模板），由 DesktopView 消费渲染。
 *
 * 正交意图：
 * 1. 原始需求（2026-07-24）：桌面提供背景修改接口，主题应用通过它设置桌面壁纸。
 *
 * 设计：
 * - 纯色/渐变/SVG 模板的色相受限（仅 hue，L/C 锁定 = 可访问性保证）；
 *   纯图片无限制（应用浮层会覆盖桌面，不影响可访问性）。
 * - background 用 $state，DesktopView 响应式订阅即时刷新。
 * - 持久化 gaubee:os:desktop，刷新后恢复。
 * - 与 themeService 正交：theme 管全局色相，desktop 管桌面背景。
 */
import { browser } from "$app/environment";
import type { AppService } from "$lib/os/services";

/**
 * 桌面背景配置（判别联合）。
 * - default：透明，露出 body 背景
 * - image：纯图片 URL（无亮度限制，应用浮层会覆盖桌面）
 * - color：受限纯色（hue 驱动，L/C 锁定 = 同 primary 亮度）
 * - gradient：受限渐变（双 hue，各自 L/C 锁定）
 * - svg：内置 SVG 模板（hue 注入模板 CSS property，支持 SVG animation/filter）
 */
export type DesktopBackground =
  | { type: "default" }
  | { type: "image"; url: string }
  | { type: "color"; hue: number }
  | { type: "gradient"; from: number; to: number }
  | { type: "svg"; templateId: string; hue: number };

/** localStorage key。 */
const STORAGE_KEY = "gaubee:os:desktop";

/** 默认背景（透明）。 */
const DEFAULT_BACKGROUND: DesktopBackground = { type: "default" };

/** 桌面服务接口。 */
export interface DesktopService extends AppService {
  readonly id: "desktop";
  readonly appId: "desktop";
  /** 当前桌面背景配置（响应式）。 */
  readonly background: DesktopBackground;
  /**
   * 当前是否处于"有壁纸"态（非 default）。
   * 单一真相源：shell 层据此在毛玻璃（透出壁纸）与纯色底（退化态）间二选一，
   * 避免 default 时毛玻璃透出 body 纯色导致文字不可读。
   */
  readonly isWallpaperActive: boolean;
  /** 设置桌面背景并持久化。 */
  setBackground(bg: DesktopBackground): void;
  /** 重置为默认背景。 */
  reset(): void;
}

/** 校验背景配置结构（从 localStorage 恢复时用）。 */
function isValidBackground(v: unknown): v is DesktopBackground {
  if (v === null || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  switch (o.type) {
    case "default":
      return true;
    case "image":
      return typeof o.url === "string";
    case "color":
      return typeof o.hue === "number";
    case "gradient":
      return typeof o.from === "number" && typeof o.to === "number";
    case "svg":
      return typeof o.templateId === "string" && typeof o.hue === "number";
    default:
      return false;
  }
}

class DesktopServiceImpl implements DesktopService {
  readonly id = "desktop" as const;
  readonly appId = "desktop" as const;

  background = $state<DesktopBackground>(DEFAULT_BACKGROUND);

  // 直接读 $state 即响应式（Svelte 5 getter 访问 $state 自动追踪依赖）。
  get isWallpaperActive(): boolean {
    return this.background.type !== "default";
  }

  constructor() {
    if (browser) {
      this.restore();
    }
  }

  setBackground(bg: DesktopBackground): void {
    this.background = bg;
    this.persist();
  }

  reset(): void {
    this.setBackground(DEFAULT_BACKGROUND);
  }

  private persist(): void {
    if (!browser) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.background));
    } catch {
      // 存储不可用，忽略
    }
  }

  private restore(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (isValidBackground(parsed)) {
        this.background = parsed;
      }
    } catch {
      // 损坏数据，忽略
    }
  }
}

/** 桌面服务单例。 */
export const desktopService: DesktopService = new DesktopServiceImpl();
