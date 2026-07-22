/**
 * 设置面板注册表。
 *
 * 解决「设置页硬编码各功能面板」的刚性耦合：
 * 应用通过 registerSettingsSection() 声明自己在设置页的入口，
 * SettingsView 遍历 registry.all() 动态渲染。
 *
 * 两种入口形态：
 * - link：点击导航到指定深链接（如 /app/account），由目标应用自己提供完整界面。
 * - render：内联渲染一个 Svelte 组件（适合轻量、就地操作的面板）。
 *
 * 谁提供能力，谁注册入口；设置应用本身不反向依赖具体业务应用。
 */
import type { Component } from "svelte";

/** 一个设置面板入口声明。 */
export interface SettingsSection {
  /** 唯一标识（如 'account'、'about'）。 */
  id: string;
  /** 显示标题。 */
  title: string;
  /** 描述（副标题）。 */
  description?: string;
  /** Lucide 图标组件。 */
  icon?: Component;
  /** 渲染顺序，越小越靠前（默认按注册顺序）。 */
  order?: number;
  /** 点击后导航到的深链接路径（优先于 render）。 */
  link?: string;
  /** 内联渲染的面板内容组件（link 未提供时使用）。 */
  render?: Component;
}

class SettingsSectionRegistry {
  private readonly sections = new Map<string, SettingsSection>();

  /** 注册或覆盖一个设置面板。 */
  register(section: SettingsSection): void {
    this.sections.set(section.id, section);
  }

  /** 注销一个设置面板。 */
  unregister(id: string): void {
    this.sections.delete(id);
  }

  /** 是否已注册某面板。 */
  has(id: string): boolean {
    return this.sections.has(id);
  }

  /** 全部面板，按 order（升序）→ 注册顺序稳定排序。 */
  all(): SettingsSection[] {
    return [...this.sections.values()].sort((a, b) => {
      const oa = a.order ?? Number.MAX_SAFE_INTEGER;
      const ob = b.order ?? Number.MAX_SAFE_INTEGER;
      return oa - ob;
    });
  }
}

/** 全局设置面板注册表单例。 */
export const settingsSectionsRegistry = new SettingsSectionRegistry();
