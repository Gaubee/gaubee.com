<script lang="ts">
	/**
	 * 技能图谱视图（osapp: skill-graph）。
	 *
	 * 数据：static/skill-graph/data.json（gaubee-skills 管道生成的 public 视图，仅公开仓信号）。
	 * 引擎：自绘 canvas 力导向（world-class-designer 设计档 2026-10-04）——
	 * 星标脱离弹簧系统（外围确定性环带，防 1640 条边汇入单点成球）、
	 * 项目按 personal/org 角向聚簇、tech 按 npm scope 弱聚簇、
	 * 碰撞力 + charge 随半径缩放 + 链长分层、默认只显示 usedBy>=2 的技术。
	 */
	import { base } from "$app/paths";
	import { Search, X } from "@lucide/svelte";
	import { onMount } from "svelte";

	interface GraphNode {
		id: string;
		kind: "user" | "project" | "tech";
		label: string;
		meta?: {
			url?: string;
			usedBy?: number;
			starUrl?: string;
			starDesc?: string;
			starCount?: number;
			starOrder?: number;
			depsCount?: number;
			ownerType?: "personal" | "org";
			order?: number;
			fromStar?: boolean;
		};
	}
	interface GraphEdge {
		from: string;
		rel: "uses" | "stars" | "echoes";
		to: string;
	}
	interface GraphData {
		view: "public";
		generated_at: string;
		stats: {
			projects: number;
			personalProjects: number;
			orgProjects: number;
			techs: number;
			stars: number;
			edges: number;
		};
		nodes: GraphNode[];
		edges: GraphEdge[];
		timeline: [string, string][];
		timelineMeta: { baselineDate: string; baselineCount: number };
	}

	let data = $state<GraphData | null>(null);
	let loadError = $state("");
	let simProgress = $state(0);
	let query = $state("");
	let detail = $state<GraphNode | null>(null);
	let tip = $state<{ x: number; y: number; label: string; sub: string } | null>(null);
	let showOrg = $state(true);
	let showPersonal = $state(true);
	let showTech = $state(true);
	let showTail = $state(false);
	let showStars = $state(true);
	let timelineIdx = $state(-1); // -1 = 不筛选，全亮

	let canvasEl: HTMLCanvasElement | undefined = $state();
	let wrapEl: HTMLDivElement | undefined = $state();

	/** 引擎句柄：视图状态由引擎每帧经 getFilters 拉取（推模式经 effect 有同步时序问题，已废弃）。 */
	let engine: { focusQuery(): void; reset(): void; destroy(): void } | null = null;

	// 走查探针（组件侧）：query/engine 断层定位用
	(window as unknown as { __sgUI?: () => Record<string, unknown> }).__sgUI = () => ({ query, hasEngine: !!engine });
	const breadthTop = $derived.by(() => {
		if (!data) return [] as { label: string; usedBy: number; starUrl: string }[];
		return data.nodes
			.filter((n) => n.kind === "tech" && !n.id.startsWith("star:") && (n.meta?.usedBy ?? 0) >= 2)
			.sort((a, b) => (b.meta?.usedBy ?? 0) - (a.meta?.usedBy ?? 0))
			.slice(0, 8)
			.map((n) => ({ label: n.label, usedBy: n.meta?.usedBy ?? 0, starUrl: n.meta?.starUrl ?? "" }));
	});
	// 时间线升序（构建端给的是最近优先降序）
	const timelineAsc = $derived.by(() => (data ? [...data.timeline].reverse() : []));

	const detailNeighbors = $derived.by(() => {
		if (!data || !detail) return { techs: [] as string[], projects: [] as string[] };
		if (detail.kind === "project") {
			return {
				techs: data.edges.filter((e) => e.from === detail!.id && e.rel === "uses").map((e) => e.to.replace("tech:", "")),
				projects: [],
			};
		}
		if (detail.kind === "tech") {
			return { techs: [], projects: data.edges.filter((e) => e.to === detail!.id && e.rel === "uses").map((e) => e.from.replace("project:", "")) };
		}
		return { techs: [], projects: [] };
	});

	function firstSeenOf(name: string): string {
		if (!data) return "";
		for (const [tech, date] of data.timeline) if (tech === name) return date;
		return "";
	}

	function load(): void {
		loadError = "";
		fetch(`${base}/skill-graph/data.json`)
			.then((r) => {
				if (!r.ok) throw new Error(`HTTP ${r.status}`);
				return r.json() as Promise<GraphData>;
			})
			.then((g) => {
				data = g;
			})
			.catch((e: unknown) => {
				loadError = e instanceof Error ? e.message : String(e);
			});
	}

	onMount(() => {
		load();
	});

	// 引擎随数据/画布就绪启动
	$effect(() => {
		if (!data || !canvasEl || !wrapEl) return;
		const handle = startEngine(
			data,
			canvasEl,
			wrapEl,
			{
				onProgress: (p) => (simProgress = p),
				onTip: (t) => (tip = t),
				onDetail: (n) => (detail = n),
			},
			{
				// 每帧拉取当前视图状态（$state 在 rAF 里读到的是最新值）
				getFilters: () => ({ showOrg, showPersonal, showTech, showTail, showStars, query, timelineIdx }),
			},
		);
		engine = handle;
		return () => {
			engine = null;
			handle.destroy();
		};
	});

	type Filters = { showOrg: boolean; showPersonal: boolean; showTech: boolean; showTail: boolean; showStars: boolean; query: string; timelineIdx: number };
	function startEngine(
		g: GraphData,
		cv: HTMLCanvasElement,
		wrap: HTMLDivElement,
		cb: { onProgress(p: number): void; onTip(t: { x: number; y: number; label: string; sub: string } | null): void; onDetail(n: GraphNode | null): void },
		io: { getFilters(): Filters },
	): { focusQuery(): void; reset(): void; destroy(): void } {
		const ctx = cv.getContext("2d");
		if (!ctx) return { focusQuery() {}, reset() {}, destroy() {} };
		const dpr = () => Math.min(devicePixelRatio || 1, 2);

		// ---- 节点集：user + project + tech；star 独立层（不进物理系统） ----
		type N = {
			id: string;
			label: string;
			k: 0 | 1 | 2 | 3; // 0 user / 1 personal / 2 org / 3 tech
			usedBy: number;
			depsCount: number;
			starUrl: string;
			starOrder: number;
			url: string;
			scope: string;
			x: number; y: number; vx: number; vy: number; r: number; deg: number;
		};
		const nodes: N[] = [];
		const stars: { label: string; url: string; order: number; x: number; y: number }[] = [];
		const idx = new Map<string, number>();
		for (const n of g.nodes) {
			if (n.id.startsWith("star:")) {
				stars.push({ label: n.label.replace("star:", ""), url: n.meta?.url ?? "", order: n.meta?.order ?? 0, x: 0, y: 0 });
				continue;
			}
			const k: 0 | 1 | 2 | 3 = n.kind === "user" ? 0 : n.kind === "project" ? ((n.meta?.ownerType ?? "personal") === "org" ? 2 : 1) : 3;
			idx.set(n.id, nodes.length);
			nodes.push({
				id: n.id, label: n.label, k,
				usedBy: n.meta?.usedBy ?? 0, depsCount: n.meta?.depsCount ?? 0,
				starUrl: n.meta?.starUrl ?? "", starOrder: n.meta?.starOrder ?? 0,
				url: n.meta?.url ?? "",
				scope: n.label.startsWith("@") ? n.label.split("/")[0] ?? "" : "",
				x: 0, y: 0, vx: 0, vy: 0, r: 4, deg: 0,
			});
		}
		type E = { s: number; t: number; rel: 0 | 1 | 2 }; // 0 uses / 1 stars(user-star 已除) / 2 echoes
		const links: E[] = [];
		for (const e of g.edges) {
			if (e.rel === "stars") continue; // user→star 不入弹簧系统（挤团病根）
			const s = idx.get(e.from);
			const t = idx.get(e.to);
			if (s === undefined || t === undefined) continue;
			links.push({ s, t, rel: e.rel === "uses" ? 0 : 2 });
			nodes[s]!.deg++;
			nodes[t]!.deg++;
		}

		// ---- 半径（语义化）与初始布局（确定性：熵来自数据，不从模型发明随机） ----
		const W = 2400, H = 1800, CX = W / 2, CY = H / 2;
		// personal 上半、org 下半，锚距拉大保证两簇可分（v2 实测调参）
		const ANCHOR = [0, -Math.PI / 2.15, Math.PI / 2.15, 0] as const;
		const ANCHOR_R = [0, 560, 820, 0] as const;
		for (let i = 0; i < nodes.length; i++) {
			const n = nodes[i]!;
			n.r = n.k === 0 ? 17 : n.k === 3 ? Math.min(3.5 + Math.sqrt(n.usedBy) * 2.6, 24) : Math.min(5 + Math.sqrt(n.depsCount) * 1.7, 15);
			const a = ANCHOR[n.k]! + (((i * 2.399963) % 1.1) - 0.55);
			const ring = n.k === 0 ? 0 : n.k === 3 ? 300 + (i % 9) * 42 : 620 + (i % 11) * 52;
			n.x = CX + Math.cos(a) * ring + ((i * 2654435761) % 97) - 48;
			n.y = CY + Math.sin(a) * ring + ((i * 40503) % 83) - 41;
		}
		// tech scope 聚簇：每个 scope 一个角向锚位（半径 340 环）
		const scopes = [...new Set(nodes.filter((n) => n.scope).map((n) => n.scope))].sort();
		const scopeAngle = new Map(scopes.map((s, i) => [s, (i / Math.max(scopes.length, 1)) * Math.PI * 2]));
		const SCOPE_R = 340;
		// 星标环：黄金角 + order 序确定性散点
		for (const s of stars) {
			const a = s.order * 2.399963;
			const r = 880 + ((s.order * 7) % 5) * 46 + (((s.order * 2654435761) % 89) - 44);
			s.x = CX + Math.cos(a) * r;
			s.y = CY + Math.sin(a) * r;
		}

		// ---- 过滤状态：每帧从视图拉取（推模式的 effect 同步不可靠，实测废弃） ----
		let f: Filters = io.getFilters();
		function refreshF(): void {
			f = io.getFilters();
		}
		const firstSeenMap = new Map(g.timeline.map(([name, date]) => [name, date] as const));
		function currentDate(): string {
			if (f.timelineIdx < 0 || !g.timeline.length) return "9999-12-31";
			return [...g.timeline].reverse()[Math.min(f.timelineIdx, g.timeline.length - 1)]?.[1] ?? "9999-12-31";
		}
		function visible(i: number): boolean {
			const n = nodes[i]!;
			if (n.k === 1 && !f.showPersonal) return false;
			if (n.k === 2 && !f.showOrg) return false;
			if (n.k === 3 && !f.showTech) return false;
			if (n.k === 3 && !f.showTail && n.usedBy < 2 && !n.starUrl) return false;
			if (f.timelineIdx >= 0 && n.k === 3) {
				const seenAt = firstSeenMap.get(n.label);
				if (!seenAt || seenAt > currentDate()) return false;
			}
			return true;
		}
		// 搜索命中集 = 命中节点 + 一跳邻域（压暗其余，不隐藏——搜索后是死路属反模式）
		const qActive = new Set<number>();
		function refreshQuerySet(): void {
			qActive.clear();
			if (!f.query) return;
			for (let i = 0; i < nodes.length; i++) {
				if (!visible(i) || !matchQ(i)) continue;
				qActive.add(i);
				for (const j of ADJ[i]!) qActive.add(j);
			}
		}

		// ---- 物理参数（设计档处方） ----
		const CELL = 110;
		const SIM_TOTAL = 300;
		const REST = [210, 96, 52] as const; // user-project / project-tech / echoes
		const STRENGTH = [0.03, 0.055, 0.028] as const;
		let simIter = 0;
		let alpha = 1;
		let stopped = false;

		function simStep(): void {
			if (stopped) return;
			const a = alpha;
			const grid = new Map<number, number[]>();
			for (let i = 0; i < nodes.length; i++) {
				const key = (((nodes[i]!.x / CELL) | 0) + 4096) * 8192 + (((nodes[i]!.y / CELL) | 0) + 4096);
				const arr = grid.get(key);
				if (arr) arr.push(i);
				else grid.set(key, [i]);
			}
			// 斥力（charge 随半径）+ 碰撞 + 聚簇
			for (let i = 0; i < nodes.length; i++) {
				const ni = nodes[i]!;
				const cx = (ni.x / CELL) | 0, cy = (ni.y / CELL) | 0;
				for (let gx = cx - 1; gx <= cx + 1; gx++) {
					for (let gy = cy - 1; gy <= cy + 1; gy++) {
						const arr = grid.get((gx + 4096) * 8192 + (gy + 4096));
						if (!arr) continue;
						for (const j of arr) {
							if (j <= i) continue;
							const nj = nodes[j]!;
							let dx = ni.x - nj.x, dy = ni.y - nj.y;
							let d2 = dx * dx + dy * dy;
							if (d2 < 1) { dx = ((i % 7) - 3) * 0.13; dy = ((j % 7) - 3) * 0.13; d2 = dx * dx + dy * dy; }
							if (d2 > 220000) continue;
							const minD = ni.r + nj.r + 6;
							if (d2 < minD * minD) {
								// 碰撞：按真实半径推开（挤团第二处方）
								const d = Math.sqrt(d2) || 0.1;
								const push = (minD - d) * 0.32;
								dx /= d; dy /= d;
								ni.x += dx * push; ni.y += dy * push;
								nj.x -= dx * push; nj.y -= dy * push;
								continue;
							}
							const d = Math.sqrt(d2) || 0.1;
							// 斥力按 1/d 衰减（d3 many-body 同款）。v3 教训：1/d² 在
							// 工作距离（80-300px）上比 1/d 弱两个数量级，等于没斥力
							const rep = Math.min(((22 + (ni.r + nj.r) * 9) * a) / d, 480);
							dx /= d; dy /= d;
							ni.vx += dx * rep; ni.vy += dy * rep;
							nj.vx -= dx * rep; nj.vy -= dy * rep;
						}
					}
				}
				// 聚簇锚力：恒定强度（不随 alpha 衰减，v3 教训——锚力若乘 alpha 会先于
				// 斥力死亡，整个组件被推离画布）；project 角向锚 / scoped tech 环形锚 / user 居中
				let ax = 0, ay = 0, gs = 0;
				if (ni.k === 1 || ni.k === 2) {
					const an = ANCHOR[ni.k]!;
					ax = CX + Math.cos(an) * ANCHOR_R[ni.k]!;
					ay = CY + Math.sin(an) * ANCHOR_R[ni.k]!;
					gs = 0.055;
				} else if (ni.k === 3 && ni.scope) {
					const an = scopeAngle.get(ni.scope) ?? 0;
					ax = CX + Math.cos(an) * SCOPE_R;
					ay = CY + Math.sin(an) * SCOPE_R;
					gs = 0.028;
				} else if (ni.k === 0) {
					ax = CX; ay = CY; gs = 0.3;
				}
				if (gs > 0) {
					ni.vx += (ax - ni.x) * gs;
					ni.vy += (ay - ni.y) * gs;
				}
			}
			// 弹簧（链长分层）
			for (const e of links) {
				const s = nodes[e.s]!, t = nodes[e.t]!;
				let dx = t.x - s.x, dy = t.y - s.y;
				const d = Math.sqrt(dx * dx + dy * dy) || 1;
				const rest = s.k === 0 || t.k === 0 ? REST[0] : e.rel === 0 ? REST[1] : REST[2];
				const st = (s.k === 0 || t.k === 0 ? STRENGTH[0] : STRENGTH[e.rel === 0 ? 1 : 2]) * a * 8;
				const force = (d - rest) * st;
				dx /= d; dy /= d;
				t.vx -= dx * force; t.vy -= dy * force;
				s.vx += dx * force; s.vy += dy * force;
			}
			// 积分
			for (const n of nodes) {
				if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) { n.x = CX + (n.id.length % 13) * 9; n.y = CY + (n.label.length % 17) * 9; n.vx = 0; n.vy = 0; }
				n.vx *= 0.55; n.vy *= 0.55;
				const sp = Math.sqrt(n.vx * n.vx + n.vy * n.vy);
				if (sp > 30) { n.vx *= 30 / sp; n.vy *= 30 / sp; }
				n.x += n.vx; n.y += n.vy;
			}
			alpha *= 0.976;
			simIter++;
			cb.onProgress(Math.min(1, simIter / SIM_TOTAL));
			if (simIter === Math.floor(SIM_TOTAL / 2)) fitView();
			if (simIter < SIM_TOTAL && alpha > 0.015) setTimeout(simStep, 0);
			else { fitView(); cb.onProgress(1); }
		}

		// ---- 渲染 ----
		const KIND_COLOR = ["", "oklch(0.72 0.13 240)", "oklch(0.74 0.14 318)", "oklch(0.8 0.13 158)"] as const;
		const COLOR_USER = "oklch(0.72 0.16 42)";
		const ADJ: number[][] = nodes.map(() => []);
		for (const e of links) { ADJ[e.s]!.push(e.t); ADJ[e.t]!.push(e.s); }
		let scale = 1, ox = 0, oy = 0, hover = -1, pin = -1, dragI = -1, panning = false, lx = 0, ly = 0, downX = 0, downY = 0;
		let dirty = true;

		function resize(): void {
			cv.width = wrap.clientWidth * dpr();
			cv.height = wrap.clientHeight * dpr();
			dirty = true;
		}
		const ro = new ResizeObserver(resize);
		ro.observe(wrap);
		resize();

		function radiusOf(n: N): number { return n.r; }
		function matchQ(i: number): boolean {
			if (!f.query) return true;
			return nodes[i]!.label.toLowerCase().includes(f.query);
		}
		function draw(): void {
			refreshF();
			const w = cv.width, h = cv.height;
			ctx!.setTransform(1, 0, 0, 1, 0, 0);
			ctx!.clearRect(0, 0, w, h);
			ctx!.setTransform(scale * dpr(), 0, 0, scale * dpr(), ox * dpr(), oy * dpr());
			const focus = pin >= 0 ? pin : hover;
			const active = new Set<number>();
			if (focus >= 0) { active.add(focus); for (const j of ADJ[focus]!) active.add(j); }
			refreshQuerySet();
			// 星标层：确定性环带，极淡（背景纹理）
			if (f.showStars) {
				ctx!.globalAlpha = 0.22;
				ctx!.fillStyle = "oklch(0.65 0.04 326)";
				for (const s of stars) {
					ctx!.beginPath();
					ctx!.arc(s.x, s.y, 2.1, 0, 6.283);
					ctx!.fill();
				}
				ctx!.globalAlpha = 1;
			}
			// 边
			ctx!.lineWidth = 1 / scale;
			for (const e of links) {
				if (!visible(e.s) || !visible(e.t)) continue;
				const on = focus >= 0 && (e.s === focus || e.t === focus);
				const qOn = f.query && qActive.has(e.s) && qActive.has(e.t);
				ctx!.strokeStyle = on || qOn ? "oklch(0.78 0.14 80 / 0.75)" : f.query || focus >= 0 ? "oklch(0.5 0.02 260 / 0.10)" : "oklch(0.55 0.03 260 / 0.28)";
				ctx!.beginPath();
				ctx!.moveTo(nodes[e.s]!.x, nodes[e.s]!.y);
				ctx!.lineTo(nodes[e.t]!.x, nodes[e.t]!.y);
				ctx!.stroke();
			}
			// 节点圆（user 最后画；标签统一画在其上——vision R2-A：标签曾被节点圆遮挡切字）
			ctx!.textAlign = "center";
			ctx!.textBaseline = "top";
			const order: number[] = [];
			for (let i = 0; i < nodes.length; i++) if (visible(i) && nodes[i]!.k !== 0) order.push(i);
			for (let i = 0; i < nodes.length; i++) if (visible(i) && nodes[i]!.k === 0) order.push(i);
			function dimmed(i: number): boolean {
				const dimByQ = !!f.query && !qActive.has(i);
				const dimByFocus = focus >= 0 && focus !== i && !active.has(i) && !(f.query && qActive.has(i));
				return dimByQ || dimByFocus;
			}
			for (const i of order) {
				const n = nodes[i]!;
				ctx!.globalAlpha = dimmed(i) ? 0.12 : 1;
				ctx!.fillStyle = focus === i ? "oklch(0.8 0.15 80)" : n.k === 0 ? COLOR_USER : KIND_COLOR[n.k]!;
				ctx!.beginPath();
				ctx!.arc(n.x, n.y, radiusOf(n), 0, 6.283);
				ctx!.fill();
				if (n.k === 0) { ctx!.lineWidth = 2.5 / scale; ctx!.strokeStyle = "oklch(0.95 0.01 90 / 0.9)"; ctx!.stroke(); }
				ctx!.globalAlpha = 1;
			}
			// ---- 标签层（节点之上）：占位矩形互斥，4 槽位（下/上/远下/远上），行距 ≥ 字高。
			//      标签在最上层，压在节点圆上也可读（vision R2-A 的病根是层级低，
			//      节点圆障碍反而把低倍率标签全灭，R4/R5 实测已废弃） ----
			const labelRects: number[][] = [];
			function rectFree(x0: number, y0: number, x1: number, y1: number): boolean {
				for (const rr of labelRects) {
					if (x0 < rr[2]! && x1 > rr[0]! && y0 < rr[3]! && y1 > rr[1]!) return false;
				}
				return true;
			}
			function placeLabel(text: string, nx: number, ny: number, r: number, fontPx: number, color: string, force = false): void {
				ctx!.font = fontPx / scale + "px 'IBM Plex Sans Variable', sans-serif";
				// 碰撞检测在屏幕坐标系：文字恒定 fontPx 屏幕高，而世界坐标矩形会随缩放
				// 缩水（R3 实测：低倍率下行距缩到 3-7px < 字高，字形相交的根因）
				const twScreen = ctx!.measureText(text).width * scale;
				const sx = nx * scale + ox, sy = ny * scale + oy, sr = r * scale;
				const gap = 4, step = fontPx + 6;
				const cands = [
					[sx - twScreen / 2, sy + sr + gap, sx + twScreen / 2, sy + sr + gap + fontPx],
					[sx - twScreen / 2, sy - sr - gap - fontPx, sx + twScreen / 2, sy - sr - gap],
					[sx - twScreen / 2, sy + sr + gap + step, sx + twScreen / 2, sy + sr + gap + step + fontPx],
					[sx - twScreen / 2, sy - sr - gap - step - fontPx, sx + twScreen / 2, sy - sr - gap - step],
				];
				for (const rc of cands) {
					if (!rectFree(rc[0]!, rc[1]!, rc[2]!, rc[3]!)) continue;
					labelRects.push(rc);
					ctx!.fillStyle = color;
					ctx!.textAlign = "left";
					ctx!.fillText(text, (rc[0]! - ox) / scale, (rc[1]! - oy) / scale);
					ctx!.textAlign = "center";
					return;
				}
				// 强制回退：user/搜索命中等优先标签宁可轻微压点也不能没名字
				//（低倍率密集区四槽全败时 rectFree 会全灭，2026-10-04 R3 实测）
				if (force) {
					const rc = cands[0]!;
					labelRects.push(rc);
					ctx!.fillStyle = color;
					ctx!.textAlign = "left";
					ctx!.fillText(text, (rc[0]! - ox) / scale, (rc[1]! - oy) / scale);
					ctx!.textAlign = "center";
				}
			}
			// 优先级：user > 搜索命中（answer node 必须有名字）> 常规分级标签；
			// 优先标签 force 落位（低倍率密集区四槽可能全败）
			const userIdx = nodes.findIndex((n) => n.k === 0);
			if (userIdx >= 0 && visible(userIdx)) {
				const un = nodes[userIdx]!;
				placeLabel(un.label, un.x, un.y, un.r, 14, "oklch(0.96 0.01 260 / 0.98)", true);
			}
			if (f.query) {
				for (let m = 0; m < nodes.length; m++) {
					const mn = nodes[m]!;
					if (mn.k === 0 || !visible(m) || !matchQ(m) || dimmed(m)) continue;
					placeLabel(mn.label, mn.x, mn.y, mn.r, 11, "oklch(0.96 0.01 260 / 0.98)", true);
				}
			}
			for (const i of order) {
				const n = nodes[i]!;
				if (n.k === 0 || dimmed(i)) continue;
				// 命中节点已在优先级路径放置，跳过（否则画出两个 zod 标签，R6 实测）
				if (f.query && matchQ(i)) continue;
				// 标签分级：技术低倍率只标头部（usedBy>=15），放大后放宽；项目放大才标
				//（低倍率全标会糊成白雾，v1 实测）；搜索命中邻域常显；占位失败则跳过
				const labeled = i === focus || qActive.has(i) || (n.k === 3 ? (scale > 1.2 ? n.usedBy >= 8 : n.usedBy >= 15) : scale > 1.05);
				if (labeled) placeLabel(n.label, n.x, n.y, radiusOf(n), 11, "oklch(0.94 0.01 260 / 0.92)");
			}
		}
		function fitView(): void {
			refreshF();
			// 只取景核心区（user/project/tech）；星标环带是外围纹理，不参与取景
			let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
			for (let i = 0; i < nodes.length; i++) {
				if (!visible(i)) continue;
				if (nodes[i]!.x < minX) minX = nodes[i]!.x;
				if (nodes[i]!.x > maxX) maxX = nodes[i]!.x;
				if (nodes[i]!.y < minY) minY = nodes[i]!.y;
				if (nodes[i]!.y > maxY) maxY = nodes[i]!.y;
			}
			if (maxX < minX) return;
			const cw = wrap.clientWidth || 1200, ch = wrap.clientHeight || 800, pad = 70;
			scale = Math.min((cw - pad * 2) / (maxX - minX || 1), (ch - pad * 2) / (maxY - minY || 1), 1.6);
			ox = (cw - (maxX + minX) * scale) / 2;
			oy = (ch - (maxY + minY) * scale) / 2;
			dirty = true;
		}
		let raf = 0;
		function loop(): void {
			if (stopped) return;
			if (dirty) { try { draw(); } catch { /* 下一帧重试 */ } dirty = false; }
			raf = requestAnimationFrame(loop);
		}
		raf = requestAnimationFrame(loop);

		// ---- 交互 ----
		function toWorld(mx: number, my: number): [number, number] { return [(mx - ox) / scale, (my - oy) / scale]; }
		function pick(mx: number, my: number): number {
			const [x, y] = toWorld(mx, my);
			let best = -1, bd = 1e9;
			for (let i = 0; i < nodes.length; i++) {
				if (!visible(i)) continue;
				const dx = nodes[i]!.x - x, dy = nodes[i]!.y - y, d = dx * dx + dy * dy;
				const r = radiusOf(nodes[i]!) + 5;
				if (d < r * r && d < bd) { bd = d; best = i; }
			}
			return best;
		}
		function onMove(e: MouseEvent): void {
			refreshF();
			const rect = cv.getBoundingClientRect();
			const mx = e.clientX - rect.left, my = e.clientY - rect.top;
			if (dragI >= 0) {
				const [x, y] = toWorld(mx, my);
				nodes[dragI]!.x = x; nodes[dragI]!.y = y;
				dirty = true;
				return;
			}
			if (panning) { ox += mx - lx; oy += my - ly; lx = mx; ly = my; dirty = true; return; }
			hover = pick(mx, my);
			if (hover >= 0) {
				const n = nodes[hover]!;
				const sub = n.k === 0 ? "Gaubee" : n.k === 3 ? `技术 · ${n.usedBy} 个项目在用` : `${n.k === 2 ? "org 项目" : "个人项目"} · ${n.depsCount} 依赖`;
				cb.onTip({ x: mx, y: my, label: n.label, sub });
				cv.style.cursor = "pointer";
			} else {
				cb.onTip(null);
				cv.style.cursor = panning ? "grabbing" : "grab";
			}
			dirty = true;
		}
		function onDown(e: MouseEvent): void {
			const rect = cv.getBoundingClientRect();
			const mx = e.clientX - rect.left, my = e.clientY - rect.top;
			downX = mx; downY = my;
			const i = pick(mx, my);
			if (i >= 0) { dragI = i; } else { panning = true; lx = mx; ly = my; }
		}
		function onUp(e: MouseEvent): void {
			refreshF();
			const rect = cv.getBoundingClientRect();
			const mx = e.clientX - rect.left, my = e.clientY - rect.top;
			const moved = Math.abs(mx - downX) + Math.abs(my - downY) > 6;
			if (dragI >= 0 && !moved) {
				pin = dragI;
				cb.onDetail(g.nodes.find((n) => n.id === nodes[dragI]!.id) ?? null);
			} else if (panning && !moved) {
				pin = -1;
				cb.onDetail(null);
			}
			dragI = -1; panning = false;
			dirty = true;
		}
		function onLeave(): void { hover = -1; cb.onTip(null); dirty = true; }
		function onWheel(e: WheelEvent): void {
			e.preventDefault();
			const rect = cv.getBoundingClientRect();
			const mx = e.clientX - rect.left, my = e.clientY - rect.top;
			const factor = e.deltaY < 0 ? 1.15 : 0.87;
			ox = mx - (mx - ox) * factor;
			oy = my - (my - oy) * factor;
			scale *= factor;
			dirty = true;
		}
		function onDblClick(): void { pin = -1; cb.onDetail(null); dirty = true; }
		cv.addEventListener("mousemove", onMove);
		cv.addEventListener("mousedown", onDown);
		window.addEventListener("mouseup", onUp);
		cv.addEventListener("mouseleave", onLeave);
		cv.addEventListener("wheel", onWheel, { passive: false });
		cv.addEventListener("dblclick", onDblClick);

		function destroy(): void {
			stopped = true;
			cancelAnimationFrame(raf);
			ro.disconnect();
			cv.removeEventListener("mousemove", onMove);
			cv.removeEventListener("mousedown", onDown);
			window.removeEventListener("mouseup", onUp);
			cv.removeEventListener("mouseleave", onLeave);
			cv.removeEventListener("wheel", onWheel);
			cv.removeEventListener("dblclick", onDblClick);
		}
		/** 聚焦当前搜索命中：取匹配子集包围盒取景（expert 故事：搜索→定位 ≤3 步）。 */
		function focusQuery(): void {
			refreshF();
			let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, any = false;
			for (let i = 0; i < nodes.length; i++) {
				if (!visible(i) || !matchQ(i)) continue;
				any = true;
				const n = nodes[i]!;
				if (n.x < minX) minX = n.x;
				if (n.x > maxX) maxX = n.x;
				if (n.y < minY) minY = n.y;
				if (n.y > maxY) maxY = n.y;
			}
			if (!any) return;
			const cw = wrap.clientWidth || 1200, ch = wrap.clientHeight || 800, pad = 130;
			scale = Math.min((cw - pad * 2) / (maxX - minX || 1), (ch - pad * 2) / (maxY - minY || 1), 2.5);
			ox = (cw - (maxX + minX) * scale) / 2;
			oy = (ch - (maxY + minY) * scale) / 2;
			pin = -1;
			dirty = true;
		}
		function reset(): void {
			pin = -1;
			refreshF();
			fitView();
			dirty = true;
		}

		simStep();
		fitView();

		// 走查探针：布局健康度（world 包围盒/模拟进度/取景）供浏览器 evaluate 读取
		(window as unknown as { __sgDebug?: () => Record<string, unknown> }).__sgDebug = () => {
			let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
			for (const n of nodes) {
				if (n.x < minX) minX = n.x;
				if (n.x > maxX) maxX = n.x;
				if (n.y < minY) minY = n.y;
				if (n.y > maxY) maxY = n.y;
			}
			return { simIter, alpha: +alpha.toFixed(4), scale: +scale.toFixed(3), bounds: [minX | 0, maxX | 0, minY | 0, maxY | 0], nodes: nodes.length, filters: { ...f } };
		};

		return { focusQuery, reset, destroy };
	}

	function focusSearch(): void {
		engine?.focusQuery();
	}
	function resetView(): void {
		query = "";
		timelineIdx = -1;
		engine?.reset();
	}
</script>

{#snippet detailPanel()}
	{#if detail}
		<div class="glass-card absolute top-3 right-3 z-10 w-72 rounded-xl p-4 text-sm">
			<div class="flex items-start justify-between gap-2">
				<div class="min-w-0">
					<div class="truncate font-semibold">{detail.label}</div>
					<div class="text-muted-foreground mt-0.5 text-xs">
						{detail.kind === "user" ? "我" : detail.kind === "tech" ? `技术 · ${detail.meta?.usedBy ?? 0} 个项目在用` : `${detail.meta?.ownerType === "org" ? "org 项目" : "个人项目"} · ${detail.meta?.depsCount ?? 0} 个依赖`}
					</div>
				</div>
				<button class="text-muted-foreground hover:text-foreground" onclick={() => (detail = null)} aria-label="关闭详情">
					<X class="size-4" />
				</button>
			</div>
			{#if detail.meta?.starUrl}
				<div class="border-border/60 mt-3 border-t pt-3 text-xs">
					<span class="text-muted-foreground">用着，也收藏了</span>
					<a class="text-primary ml-1 break-all" href={detail.meta.starUrl} target="_blank" rel="noreferrer">{detail.meta.starUrl.replace("https://github.com/", "")}</a>
					{#if detail.meta.starDesc}<div class="text-muted-foreground mt-1">{detail.meta.starDesc}</div>{/if}
				</div>
			{/if}
			{#if detail.kind === "tech" && firstSeenOf(detail.label)}
				<div class="text-muted-foreground mt-2 text-xs">首次采用：{firstSeenOf(detail.label)}</div>
			{/if}
			{#if detailNeighbors.techs.length}
				<div class="border-border/60 mt-3 border-t pt-3">
					<div class="text-muted-foreground text-xs">依赖 {detailNeighbors.techs.length}</div>
					<div class="mt-1.5 flex flex-wrap gap-1">
						{#each detailNeighbors.techs.slice(0, 14) as t}
							<span class="bg-muted rounded px-1.5 py-0.5 text-xs">{t}</span>
						{/each}
					</div>
				</div>
			{/if}
			{#if detailNeighbors.projects.length}
				<div class="border-border/60 mt-3 border-t pt-3">
					<div class="text-muted-foreground text-xs">使用方</div>
					<div class="mt-1.5 flex flex-wrap gap-1">
						{#each detailNeighbors.projects.slice(0, 12) as p}
							<span class="bg-muted rounded px-1.5 py-0.5 text-xs">{p}</span>
						{/each}
					</div>
				</div>
			{/if}
			{#if detail.meta?.url}
				<a class="text-primary mt-3 inline-block text-xs" href={detail.meta.url} target="_blank" rel="noreferrer">在 GitHub 打开 ↗</a>
			{/if}
		</div>
	{/if}
{/snippet}

<div class="flex h-full min-h-0 flex-col">
	<header class="border-border/60 bg-card/60 flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-2.5 backdrop-blur-xl">
		<h1 class="text-base font-semibold">技能图谱</h1>
		{#if data}
			<span class="text-muted-foreground text-xs">
				{data.stats.projects} 项目（个人 {data.stats.personalProjects} / org {data.stats.orgProjects}）· {data.stats.techs} 技术 · {data.stats.stars} 星标
			</span>
		{/if}
		<div class="bg-background/70 border-border/60 focus-within:border-ring ml-auto flex items-center gap-1.5 rounded-lg border px-2.5 py-1">
			<Search class="text-muted-foreground size-3.5" />
			<input
				class="w-40 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
				placeholder="搜索技术 / 项目"
				bind:value={query}
				onkeydown={(e) => e.key === "Enter" && focusSearch()}
			/>
		</div>
		<div class="flex flex-wrap items-center gap-1.5 text-xs">
			<button class="border-border/60 rounded-full border px-2.5 py-0.5 transition-colors data-[on=false]:text-muted-foreground" data-on={showPersonal} onclick={() => (showPersonal = !showPersonal)}>个人项目</button>
			<button class="border-border/60 rounded-full border px-2.5 py-0.5 transition-colors data-[on=false]:text-muted-foreground" data-on={showOrg} onclick={() => (showOrg = !showOrg)}>org 项目</button>
			<button class="border-border/60 rounded-full border px-2.5 py-0.5 transition-colors data-[on=false]:text-muted-foreground" data-on={showTech} onclick={() => (showTech = !showTech)}>技术</button>
			<button class="border-border/60 rounded-full border px-2.5 py-0.5 transition-colors data-[on=false]:text-muted-foreground" data-on={showTail} onclick={() => (showTail = !showTail)}>长尾技术</button>
			<button class="border-border/60 rounded-full border px-2.5 py-0.5 transition-colors data-[on=false]:text-muted-foreground" data-on={showStars} onclick={() => (showStars = !showStars)}>星标层</button>
			<button class="text-muted-foreground hover:text-foreground px-1.5 py-0.5" onclick={resetView}>复位</button>
		</div>
	</header>

	<main class="relative min-h-0 flex-1">
		{#if loadError}
			<div class="text-muted-foreground absolute inset-0 flex flex-col items-center justify-center gap-2">
				<p>数据加载失败：{loadError}</p>
				<button class="border-border/60 rounded-lg border px-3 py-1 text-sm" onclick={load}>重试</button>
			</div>
		{:else if !data}
			<div class="absolute inset-0 flex items-center justify-center">
				<div class="text-muted-foreground animate-pulse text-sm">图谱加载中…</div>
			</div>
		{:else}
			<div bind:this={wrapEl} class="absolute inset-0">
				<canvas bind:this={canvasEl} class="absolute inset-0 h-full w-full cursor-grab"></canvas>
			</div>

			{#if detail}
				{@render detailPanel()}
			{/if}

			{#if tip}
				<div class="bg-popover/90 border-border/60 text-popover-foreground pointer-events-none absolute z-10 max-w-64 rounded-lg border px-3 py-2 text-xs shadow-lg backdrop-blur-xl" style="left:{tip.x + 14}px; top:{tip.y + 10}px">
					<div class="font-medium">{tip.label}</div>
					<div class="text-muted-foreground">{tip.sub}</div>
				</div>
			{/if}

			{#if breadthTop.length}
				<div class="glass-card border-border/60 absolute top-3 left-3 rounded-xl border p-3 backdrop-blur-xl">
					<div class="text-muted-foreground mb-1.5 text-xs">最常用技术</div>
					<div class="flex flex-wrap gap-1.5">
						{#each breadthTop as b}
							<button class="bg-muted/70 hover:border-ring rounded-full border border-transparent px-2 py-0.5 text-xs" onclick={() => (query = b.label)}>
								{b.label} <span class="text-muted-foreground">×{b.usedBy}</span>
							</button>
						{/each}
					</div>
				</div>
			{/if}

			<div class="text-muted-foreground absolute bottom-3 left-3 z-10 flex items-center gap-3 text-xs backdrop-blur-sm">
				<span class="flex items-center gap-1.5"><span class="bg-primary inline-block size-2.5 rounded-full"></span>我</span>
				<span class="flex items-center gap-1.5"><span class="inline-block size-2.5 rounded-full" style="background: oklch(0.72 0.13 240)"></span>个人项目</span>
				<span class="flex items-center gap-1.5"><span class="inline-block size-2.5 rounded-full" style="background: oklch(0.74 0.14 318)"></span>org 项目</span>
				<span class="flex items-center gap-1.5"><span class="inline-block size-2.5 rounded-full" style="background: oklch(0.8 0.13 158)"></span>技术</span>
				<span class="hidden 2xl:inline">拖节点 · 滚轮缩放 · 单击看详情 · 双击取消</span>
			</div>

			{#if simProgress < 1}
				<div class="absolute right-3 bottom-3 z-10 text-xs">
					<div class="bg-card/70 border-border/60 h-1.5 w-28 overflow-hidden rounded-full border backdrop-blur">
						<div class="bg-foreground/50 h-full transition-[width]" style="width: {Math.round(simProgress * 100)}%"></div>
					</div>
				</div>
			{/if}

			{#if timelineAsc.length}
				<div class="bg-card/60 border-border/60 absolute bottom-3 left-1/2 z-10 w-[min(560px,calc(100%-2rem))] -translate-x-1/2 rounded-xl border px-4 py-2 backdrop-blur-xl">
					<div class="text-muted-foreground flex items-center justify-between text-xs">
						<span>新技术采用时间线</span>
						<span>{timelineIdx >= 0 ? timelineAsc[timelineIdx]?.[1] ?? "" : "全部"}</span>
					</div>
					<input
						type="range"
						class="accent-primary mt-1 w-full"
						min="-1"
						max={timelineAsc.length - 1}
						step="1"
						bind:value={timelineIdx}
						aria-label="采用时间线"
					/>
				</div>
			{:else if data?.timelineMeta?.baselineDate}
				<div class="bg-card/60 border-border/60 text-muted-foreground absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-xl border px-4 py-1.5 text-xs backdrop-blur-xl">
					依赖跟踪自 {data.timelineMeta.baselineDate} 开始：{data.timelineMeta.baselineCount} 项技术为跟踪前存量；仓库新增依赖的当天起这里出现时间线
				</div>
			{/if}
		{/if}
	</main>
</div>

<style>
	.glass-card {
		background: color-mix(in oklch, var(--card) 72%, transparent);
		backdrop-filter: blur(12px) contrast(2) brightness(0.8);
	}
	:global(.dark) .glass-card {
		backdrop-filter: blur(12px) contrast(0.8) brightness(1.2);
	}
</style>
