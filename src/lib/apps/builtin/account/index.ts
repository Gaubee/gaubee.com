/**
 * 账户应用（系统内置，不可卸载）。
 *
 * 职责：
 * 1. 提供 AccountService（账户登录态、登录/登出、鉴权守卫），供其它应用获取。
 * 2. 提供独立的账户界面（/app/account 深链接），参考 macOS 账户面板。
 * 3. 声明式注册设置页「账户」入口（manifest.settingsSections，AppManager 投影）。
 *
 * 通过 manifest.services 声明 account service，由 AppManager 投影到
 * appServiceRegistry；其它应用经 gaubeeos.getAppService('account') 获取。
 */
import User from "@lucide/svelte/icons/user";
import type { AppEntry } from "../../types";
import { accountService } from "./service";

export const accountApp: AppEntry = {
  manifest: {
    id: "account",
    name: "账户",
    icon: User,
    category: "system",
    defaultArea: "main",
    activities: [
      {
        route: "/app/account",
        entry: true,
        view: () => import("$lib/apps/views/AccountView.svelte"),
      },
    ],
    // 不占主导航 tab，只通过 /app/account 深链接进入（设置页入口跳转过来）
    hiddenFromNav: true,
    vfsOwnership: [],
    // 向 GaubeeOS 暴露 account 服务
    services: {
      account: () => accountService,
    },
    // 声明式设置面板（点击跳转到 /app/account）
    settingsSections: [
      {
        id: "account",
        title: "账户",
        description: "登录、管理账户与会话",
        icon: User,
        order: 0,
        link: "/app/account",
      },
    ],
  },
};
