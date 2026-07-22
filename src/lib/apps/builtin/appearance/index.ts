/**
 * 外观（主题）设置注册。
 *
 * 主题切换是 OS 级外观偏好，不属于任何具体业务应用。
 * 这里把 AppearanceSection 注册到设置页（settingsSectionsRegistry），
 * 让设置页动态渲染主题切换面板——移动端和桌面端都能从设置页切换主题。
 *
 * 注册由布局层 import 触发（见 src/lib/apps/registry.ts 或 +layout.svelte）。
 */
import PaletteIcon from "@lucide/svelte/icons/palette";
import { settingsSectionsRegistry } from "../settings-sections";
import AppearanceSection from "./AppearanceSection.svelte";

settingsSectionsRegistry.register({
  id: "appearance",
  title: "外观",
  description: "切换明暗主题",
  icon: PaletteIcon,
  order: 1, // 排在账户（order:0）之后
  render: AppearanceSection,
});
