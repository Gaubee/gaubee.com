import { leafRoute } from "$lib/router";
/**
 * Geo 规则应用（系统内置，hiddenFromNav）。
 *
 * cdn-media-bootstrap Phase 2（openspec R5）：cdn-media 地区路由规则的后台配置入口。
 * 仅 Owner 有界面权限（GeoRulesView 内做 owner 判定，同 EventView）；
 * 通过深链接 `/app/geo-rules` 直达（地址栏输入），不占 Dock 图标。
 */
import Globe from "@lucide/svelte/icons/globe";

import type { AppEntry } from "../types";

export const geoRulesApp: AppEntry = {
	manifest: {
		id: "geo-rules",
		name: "Geo 规则",
		icon: Globe,
		category: "system",
		defaultArea: "main",
		hiddenFromNav: true,
		activities: [
			{
				pattern: "/app/geo-rules",
				entry: true,
				root: leafRoute("geo-rules", () => import("$lib/apps/views/GeoRulesView.svelte")),
			},
		],
		description: "cdn-media 地区路由规则配置",
		longDescription:
			"配置 /api/geo 返回的 mediaBase 地区规则（KV 存储，Owner 限定写入）。默认同源不重写，改规则即可灰度/切流，不碰 DNS。",
	},
};
