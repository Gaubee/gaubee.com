/**
 * ScrollSpy DOM 适配层 —— 把纯算法（scroll-spy.ts）接入浏览器。
 *
 * 正交意图：
 * 1. 节点遍历（DOM → SpyNode 序列）：用 TreeWalker 或 querySelectorAll 配合 detector。
 * 2. 范围几何（SpyNode → Rect[]）：用 Range + getClientRects 跨节点取矩形。
 * 3. 事件驱动（scroll/resize/mutation → 重算 → onUpdate 回调）。
 *
 * 设计：本文件包含所有 DOM 依赖，方便 SSR 时 tree-shake；纯算法见 scroll-spy.ts。
 */
import {
  computeHighlightMap,
  computeNodeRanges,
  recomputeRangesFrom,
  type Rect,
  type SpyNode,
} from "./scroll-spy";

/** 节点识别器：遍历容器子树时，对每个元素判定是否为 ToC 节点。 */
export interface SpyNodeDetector {
  detect(el: HTMLElement): { id: string; depth: number } | null;
}

/** 高亮强度映射（与纯算法层 HighlightMap 等价）。 */
export type HighlightMap = Map<string, number>;

/** createScrollSpy 选项。 */
export interface ScrollSpyOptions {
  /** 内容根容器（ToC 节点的祖先，Range 以此为界）。 */
  container: HTMLElement;
  /** 节点识别器。 */
  detector: SpyNodeDetector;
  /**
   * 滚动视口（决定交集判定基准与 scroll 事件源）。
   * 通常为 `.main-content`（AreaOutlet 内的实际滚动容器）。
   */
  viewport: HTMLElement;
  /**
   * 视口顶部偏移（吸顶 nav 等遮挡层高度）。
   * 节点 range 的 top 会减去此值，让"刚滚入视野"的判定对齐吸顶位置。
   * 默认 0。
   */
  topOffset?: number;
  /** 每次高亮更新触发（scroll/resize/mutation 后）。 */
  onUpdate: (map: HighlightMap) => void;
}

/** ScrollSpy 实例句柄。 */
export interface ScrollSpyHandle {
  /** 立即重算并触发一次 onUpdate（外部强制刷新用）。 */
  refresh(): void;
  /** 销毁：解绑所有事件、断开 observer。 */
  destroy(): void;
}

/**
 * 创建 ScrollSpy 实例。
 *
 * 工作流：
 * 1. collectNodes：遍历 container，过 detector，得 SpyNode[]（按 DOM 顺序）
 * 2. computeNodeRanges：纯算法填 endElement
 * 3. computeHighlightMap：用 Range.getClientRects + viewport 算每个节点 ratio
 * 4. 监听 viewport scroll + window resize + container MutationObserver，触发 3 重算
 *
 * 性能：
 * - scroll 用 requestAnimationFrame 节流（避免每帧重算所有 Range）
 * - MutationObserver 仅在结构变动时触发 collectNodes（增量见 scroll-spy.ts recomputeRangesFrom）
 */
export function createScrollSpy(opts: ScrollSpyOptions): ScrollSpyHandle {
  const { container, detector, viewport, onUpdate } = opts;
  const topOffset = opts.topOffset ?? 0;

  let nodes: SpyNode<HTMLElement>[] = [];
  let rafId: number | null = null;

  /** 遍历容器收集 ToC 节点（按 DOM 顺序）。 */
  function collectNodes(): SpyNode<HTMLElement>[] {
    const result: SpyNode<HTMLElement>[] = [];
    // querySelectorAll 返回 document 顺序，符合按出现顺序排列的要求。
    const all = container.querySelectorAll<HTMLElement>("*");
    for (const el of all) {
      const detected = detector.detect(el);
      if (detected) {
        result.push({
          id: detected.id,
          depth: detected.depth,
          startElement: el,
          endElement: null,
        });
      }
    }
    return computeNodeRanges(result);
  }

  /** 取一个 SpyNode 范围（startElement..endElement）的所有矩形。 */
  function getNodeRects(start: HTMLElement, end: HTMLElement | null): Rect[] {
    const range = document.createRange();
    try {
      range.setStartBefore(start);
      if (end) {
        range.setEndBefore(end);
      } else {
        // endElement=null → 到 container 末尾
        range.setEndAfter(container);
      }
      // getClientRects 返回跨多节点元素的并集矩形列表（自动跳过无内容范围）
      const rects = range.getClientRects();
      const out: Rect[] = [];
      for (let i = 0; i < rects.length; i++) {
        const r = rects[i];
        out.push({
          top: r.top - topOffset,
          bottom: r.bottom - topOffset,
          left: r.left,
          right: r.right,
        });
      }
      return out;
    } catch {
      // Range 失败（DOM 结构异常）→ 返回空，该节点 ratio=0
      return [];
    }
  }

  /** 取当前 viewport 的矩形（已扣 topOffset）。 */
  function getViewportRect(): Rect {
    const r = viewport.getBoundingClientRect();
    return {
      top: r.top - topOffset,
      bottom: r.bottom - topOffset,
      left: r.left,
      right: r.right,
    };
  }

  /** 重算所有节点的高亮映射并触发 onUpdate。 */
  function recompute(): void {
    if (nodes.length === 0) {
      onUpdate(new Map());
      return;
    }
    const viewportRect = getViewportRect();
    const map = computeHighlightMap(nodes, getNodeRects, viewportRect);
    onUpdate(map);
  }

  /** rAF 节流的重算调度。 */
  function scheduleRecompute(): void {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      recompute();
    });
  }

  /** 重建节点表（DOM 结构变动后）。 */
  function rebuildNodes(): void {
    nodes = collectNodes();
    scheduleRecompute();
  }

  // ---- 初始化 ----
  nodes = collectNodes();

  // 滚动事件：视口在节点内滑动 → 重算高亮
  const scrollHandler = (): void => scheduleRecompute();
  viewport.addEventListener("scroll", scrollHandler, { passive: true });

  // resize：viewport 尺寸变化 → 重算
  const resizeHandler = (): void => scheduleRecompute();
  window.addEventListener("resize", resizeHandler, { passive: true });

  // DOM 结构变动：节点增删/内容重渲染（如 Shiki 高亮异步完成）→ 重建节点表
  const mutationObserver = new MutationObserver((mutations) => {
    // 仅 childList / subtree 变动需要重建（attribute/style 变化不影响节点结构）
    const structural = mutations.some((m) => m.type === "childList");
    if (structural) rebuildNodes();
  });
  mutationObserver.observe(container, {
    childList: true,
    subtree: true,
  });

  // 首次计算（下个帧，确保布局完成）
  scheduleRecompute();

  return {
    refresh(): void {
      rebuildNodes();
      recompute();
    },
    destroy(): void {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      viewport.removeEventListener("scroll", scrollHandler);
      window.removeEventListener("resize", resizeHandler);
      mutationObserver.disconnect();
    },
  };
}

/**
 * 内置 detector 工厂（常用场景开箱即用）。
 */

/**
 * Markdown heading detector：识别带 id 的 h2/h3。
 * 配合 marked-gfm-heading-id 注入的 id（与正文 anchor 一致）。
 */
export function createMarkdownHeadingDetector(): SpyNodeDetector {
  return {
    detect(el) {
      if (el.tagName === "H2" || el.tagName === "H3") {
        const id = el.id;
        if (id) return { id, depth: el.tagName === "H2" ? 2 : 3 };
      }
      return null;
    },
  };
}

/**
 * 按 id 前缀识别 section 的 detector（如文章列表的 `year-{year}` 分组）。
 * @param idPrefix id 前缀（如 "year-"）
 * @param depth 节点层级（默认 2）
 */
export function createPrefixedSectionDetector(idPrefix: string, depth = 2): SpyNodeDetector {
  return {
    detect(el) {
      if (el.tagName === "SECTION") {
        const id = el.id;
        if (id.startsWith(idPrefix)) return { id, depth };
      }
      return null;
    },
  };
}

/**
 * 找元素最近的可滚动祖先（overflow-y: auto/scroll）。
 *
 * 用于自动定位 ScrollSpy 的 viewport——caller 不必关心滚动容器是
 * `.main-content`（普通 tab 应用）还是 `div.h-full.overflow-auto`
 * （详情页 deep-link 分支），统一用此函数向上找。
 *
 * 不要求 scrollHeight > clientHeight：内容渲染是异步的，初始可能未溢出，
 * 但 overflow:auto 已声明意图即为滚动容器。监听其 scroll 事件无害。
 */
export function findScrollParent(el: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = el.parentElement;
  while (node) {
    const style = getComputedStyle(node);
    const overflowY = style.overflowY;
    if (overflowY === "auto" || overflowY === "scroll") {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}
