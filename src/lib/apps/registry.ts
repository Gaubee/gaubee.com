import { appManager } from "./AppManager.svelte";
import { accountApp } from "./builtin/account";
import { appStoreApp } from "./builtin/app-store";
import { articlesApp } from "./builtin/articles";
// 系统应用（直接静态 import，打包进主代码）
import { desktopApp } from "./builtin/desktop";
import { eventApp } from "./builtin/event";
import { notificationsApp } from "./builtin/notifications";
import { searchApp } from "./builtin/search";
import { settingsApp } from "./builtin/settings";
import { geoRulesApp } from "./builtin/geo-rules";
import { skillGraphApp } from "./builtin/skill-graph";
import { themeApp } from "./builtin/theme";
import { filesApp } from "./installable/files";
// 可安装应用（动态 import，按需加载）
import { githubApp } from "./installable/github";
import { githubEditorApp } from "./installable/github-editor";
import { jsonViewerApp } from "./installable/json-viewer";
import { terminalApp } from "./installable/terminal";
/**
 * GaubeeOS 应用注册中心。
 *
 * 所有应用的静态注册入口。
 * 系统应用（builtin）直接静态 import 视图组件。
 * 可安装应用（installable）通过动态 import 按需加载。
 */
import type { AppEntry } from "./types";

let registered = false;

/** 注册所有应用（幂等）。 */
export function registerAllApps(): void {
  if (registered) return;
  registered = true;

  // 系统应用（内置，不可卸载）。desktop 首位（默认首页 mainTabs[0]）。
  appManager.register(desktopApp);
  appManager.register(articlesApp);
  appManager.register(eventApp);
  appManager.register(searchApp);
  appManager.register(settingsApp);
  appManager.register(notificationsApp);
  appManager.register(accountApp);
  appManager.register(appStoreApp);
  appManager.register(themeApp);
  appManager.register(skillGraphApp);
  appManager.register(geoRulesApp);

  // 可安装应用（默认不安装，用户手动安装）
  appManager.register(githubApp);
  appManager.register(githubEditorApp);
  appManager.register(terminalApp);
  appManager.register(filesApp);
  appManager.register(jsonViewerApp);

  // 初始化：恢复用户安装状态
  appManager.init();
}

// 导出各应用 manifest 供外部使用
export {
  desktopApp,
  articlesApp,
  eventApp,
  searchApp,
  settingsApp,
  notificationsApp,
  accountApp,
  appStoreApp,
  themeApp,
  skillGraphApp,
  geoRulesApp,
};
export { githubApp, githubEditorApp, terminalApp, filesApp, jsonViewerApp };

/** 获取所有已注册应用。 */
export function getAllRegisteredApps(): AppEntry[] {
  return [
    desktopApp,
    articlesApp,
    eventApp,
    searchApp,
    settingsApp,
    notificationsApp,
    accountApp,
    appStoreApp,
    themeApp,
    skillGraphApp,
    geoRulesApp,
    githubApp,
    githubEditorApp,
    terminalApp,
    filesApp,
    jsonViewerApp,
  ];
}

// 模块加载时自动注册（在 nav-controller-instance.ts 之前执行）
registerAllApps();
