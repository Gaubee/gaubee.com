/**
 * 桌面布局 store（应用显示顺序 + 显隐 + 管理桌面弹窗开关）。
 *
 * 数据结构：单个有序数组 desktopApps（用户选择在桌面显示的应用 id，按顺序）。
 * 设计原则：持久化层只存用户意图的最小集，其余动态派生 + 兜底。
 *
 * - 桌面显示 = desktopApps ∩ allInstalled（动态过滤已卸载 id，卸载零联动写入）。
 * - 隐藏应用 = allInstalled 中不在 desktopApps 的（动态派生）。
 * - 新安装应用若已在 desktopApps 则按序显示；不在则默认隐藏（用户可在管理桌面拖到显示组）。
 * - id 清洗：读取时过滤 appManager 不认识的 id（已卸载残留）。
 *
 * 安装/卸载对持久化数据零联动——只有用户主动操作（拖拽排序/显隐）才写入。
 */
import type { InstalledApp } from "./types";

const STORAGE_KEY = "gaubee:os:desktop-layout";
const PERSIST_DEBOUNCE_MS = 300;
/** 默认隐藏的应用（系统服务类，桌面网格不显示）。 */
const DEFAULT_HIDDEN = ["search", "notifications", "settings"];

interface PersistedDesktopLayout {
  desktopApps: string[];
  updatedAt: number;
}

function readStorage(): PersistedDesktopLayout | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed == null) return null;
    const record = parsed as Record<string, unknown>;
    if (!Array.isArray(record.desktopApps)) return null;
    return {
      desktopApps: (record.desktopApps as unknown[]).filter(
        (id): id is string => typeof id === "string",
      ),
      updatedAt:
        typeof record.updatedAt === "number" ? record.updatedAt : 0,
    };
  } catch {
    return null;
  }
}

function writeStorage(layout: PersistedDesktopLayout): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // ignore
  }
}

class DesktopLayoutStore {
  /** 用户选择在桌面显示的应用 id（有序）。 */
  desktopApps = $state<string[]>([]);
  /** 管理桌面弹窗开关。 */
  launchpadOpen = $state(false);

  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private initialized = false;

  /** 初始化：从 localStorage 恢复 + id 清洗；首次访问按默认规则初始化。 */
  init(allInstalled: readonly InstalledApp[]): void {
    if (this.initialized) return;
    this.initialized = true;

    const knownIds = new Set(
      allInstalled.filter((a) => a.id !== "desktop").map((a) => a.id),
    );
    const persisted = readStorage();
    if (persisted) {
      // 清洗：过滤已卸载的残留 id
      this.desktopApps = persisted.desktopApps.filter((id) =>
        knownIds.has(id),
      );
    } else {
      // 首次访问：默认显示所有非隐藏应用（按 registry 顺序），隐藏 search/notifications/settings
      this.desktopApps = allInstalled
        .filter(
          (a) =>
            a.id !== "desktop" && !DEFAULT_HIDDEN.includes(a.id),
        )
        .map((a) => a.id);
      this.schedulePersist();
    }
  }

  /** 桌面显示的应用（已安装 ∩ desktopApps，按 desktopApps 顺序）。 */
  visibleApps(allInstalled: readonly InstalledApp[]): InstalledApp[] {
    const byId = new Map(allInstalled.map((a) => [a.id, a]));
    return this.desktopApps
      .map((id) => byId.get(id))
      .filter((a): a is InstalledApp => a !== undefined);
  }

  /** 隐藏的应用（已安装但不在 desktopApps，排除 desktop 自身）。 */
  hiddenApps(allInstalled: readonly InstalledApp[]): InstalledApp[] {
    const visible = new Set(this.desktopApps);
    return allInstalled.filter(
      (a) => a.id !== "desktop" && !visible.has(a.id),
    );
  }

  /** 组内排序：把 fromId 移到 toId 的位置。 */
  reorder(fromId: string, toId: string): void {
    const apps = [...this.desktopApps];
    const fromIdx = apps.indexOf(fromId);
    const toIdx = apps.indexOf(toId);
    if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;
    apps.splice(fromIdx, 1);
    apps.splice(toIdx, 0, fromId);
    this.desktopApps = apps;
    this.schedulePersist();
  }

  /** 从隐藏移到显示（追加到末尾）。 */
  moveToVisible(appId: string): void {
    if (this.desktopApps.includes(appId)) return;
    this.desktopApps = [...this.desktopApps, appId];
    this.schedulePersist();
  }

  /** 从显示移到隐藏。 */
  moveToHidden(appId: string): void {
    if (!this.desktopApps.includes(appId)) return;
    this.desktopApps = this.desktopApps.filter((id) => id !== appId);
    this.schedulePersist();
  }

  openLaunchpad(): void {
    this.launchpadOpen = true;
  }
  closeLaunchpad(): void {
    this.launchpadOpen = false;
  }

  private schedulePersist(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      writeStorage({
        desktopApps: [...this.desktopApps],
        updatedAt: Date.now(),
      });
    }, PERSIST_DEBOUNCE_MS);
  }
}

/** 全局单例。 */
export const desktopLayout = new DesktopLayoutStore();
