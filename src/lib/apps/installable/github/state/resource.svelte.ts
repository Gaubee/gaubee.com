/**
 * createResource：异步数据资源的 runes 工厂（Svelte 5）。
 *
 * 收口 GithubApp 内散落的 `loading + error + data` 三元组样板，内置：
 *  - 状态机派生（idle/loading/refreshing/success/empty/error/stale-error，见 ./status.ts）
 *  - 竞态防护（seq 序号，丢弃过期请求结果，替代手写 searchSeq/loadSeq）
 *  - refreshing/stale-error 保留旧 data（网络抖动不清空）
 *  - silent 选项（辅助数据静默失败，不设 error）
 *  - isEmpty 列表空态判定
 *  - setData mutation（评论 CRUD 等本地更新）
 *
 * 设计意图：消除 15+ 处重复的 `let xxxLoading = $state(false)` + try/catch/finally 样板，
 * 让视图层只声明「数据从哪来」，状态机自动驱动 loading/error/empty/refreshing 渲染。
 *
 * 用法：
 * ```ts
 * const commits = createResource(
 *   () => listCommits({ owner, repo, perPage: 30 }),
 *   { isEmpty: (a) => a.length === 0, errorMessage: "加载历史失败" },
 * );
 * // 触发（监听参数变化）
 * $effect(() => { if (owner && repo) void commits.run(); });
 * // 渲染（<AsyncBoundary resource={commits}>...）
 * ```
 *
 * 注意：分页/增量加载（如 listCache、文件树 loadingDirs）形态不匹配，不适用本工厂。
 */
import { untrack } from "svelte";

import { deriveStatus, type ResourceStatus } from "./status";

/** createResource 的配置项。 */
export interface CreateResourceOptions<T> {
  /** 初始数据（保活场景：组件重挂载时先展示旧数据再刷新）。 */
  initialData?: T;
  /** 兜底错误文案（fetcher 抛非 Error 时使用）。 */
  errorMessage?: string;
  /** 静默失败：辅助数据（repoInfo/counts 等）失败时不设 error，保留旧 data/loading=false。
   *  与普通失败的区别：普通失败 → error/stale-error（显示错误条）；silent 失败 → 保持 success/idle。 */
  silent?: boolean;
  /** 列表空态判定（返回 true 则 status=empty，渲染空态而非数据）。单值资源不传。 */
  isEmpty?: (data: T) => boolean;
}

/** 资源实例（响应式，字段为 $state/$derived，模板可直接读）。 */
export interface Resource<T> extends ReadonlyResource<T> {
  /** 本地更新数据（mutation 后无需重新请求，如评论 CRUD）。
   *  传入函数时接收 prev（可能 null），返回新值。 */
  setData(updater: T | null | ((prev: T | null) => T | null)): void;
  /** 重置到初始态（清空 data/error，status 回 idle）。 */
  reset(): void;
}

/**
 * 资源的只读视图（协变于 T）。
 *
 * 仅含读取成员（T 只出现在返回值位置），故 ReadonlyResource<CommitDetail> 可赋值给
 * ReadonlyResource<unknown>。AsyncBoundary 等纯渲染组件用此类型接收 resource，
 * 避免 Resource<T> 因 setData 逆变导致的 `Resource<X> 不可赋值 Resource<unknown>` 问题。
 */
export interface ReadonlyResource<out T> {
  /** 当前数据（null 表示未加载或已重置）。 */
  readonly data: T | null;
  /** 当前错误信息（null 表示无错误）。 */
  readonly error: string | null;
  /** 是否正在加载（loading 或 refreshing）。 */
  readonly isLoading: boolean;
  /** 派生状态（由 data/error/isLoading 计算，见 status.ts）。 */
  readonly status: ResourceStatus;
  /** 是否有可渲染数据（列表看调用方 hasData 配置，单值看 data 非 null）。 */
  readonly hasData: boolean;
  /** 触发加载（内置 seq 竞态防护，丢弃过期结果）。 */
  run(): Promise<void>;
}

/**
 * 创建一个异步数据资源。
 *
 * @param fetcher 数据获取函数（返回 Promise<T>）。每次 run() 调用都会执行。
 * @param options 配置项（见 CreateResourceOptions）。
 */
export function createResource<T>(
  fetcher: () => Promise<T>,
  options: CreateResourceOptions<T> = {},
): Resource<T> {
  const { initialData = null, errorMessage, silent = false, isEmpty } = options;

  // hasData 判定：列表/单值统一。data 非 null 即视为「有数据」，
  // 具体是否「空列表」交给 isEmpty 再细分（影响 success vs empty）。
  // 注意：这里用函数封装避免在 $derived 里重复访问 $state 闭包变量。
  let data = $state<T | null>(initialData);
  let error = $state<string | null>(null);
  let isLoading = $state(false);

  // 竞态序号（非响应式，纯实例字段）。每次 run 递增，回调比对决定是否丢弃过期结果。
  let seq = 0;

  const hasData = $derived(data !== null);
  const status = $derived(
    deriveStatus({
      data,
      error,
      isLoading,
      hasData,
      isEmpty: isEmpty as ((data: T) => boolean) | undefined,
    }),
  );

  async function run(): Promise<void> {
    const mySeq = ++seq;
    // untrack 读取 hasData：避免在调用方的 $effect 同步阶段建立对 data 的依赖，
    // 否则 run() 写 data → data 变 → effect 重跑 → 死循环。
    // 写操作（isLoading/error/data 赋值）本身不建立依赖，无需 untrack。
    const hadData = untrack(() => hasData);
    isLoading = true;
    // 仅在无旧数据时清 error（refreshing 场景保留旧 error 直到新数据到达，避免闪烁）
    if (!hadData) error = null;
    try {
      const result = await fetcher();
      // 竞态丢弃：序号不匹配说明已有更新的 run 在途/已完成，丢弃本次结果
      if (mySeq !== seq) return;
      data = result;
      error = null;
    } catch (e) {
      if (mySeq !== seq) return;
      if (silent) {
        // 静默失败：保留旧 data（若有），不清空，不设 error
        // 无旧数据时 data 保持 null，status 回 idle（而非 error）
      } else {
        error = e instanceof Error ? e.message : (errorMessage ?? "加载失败");
      }
    } finally {
      if (mySeq === seq) isLoading = false;
    }
  }

  function setData(updater: T | null | ((prev: T | null) => T | null)): void {
    data = typeof updater === "function" ? (updater as (p: T | null) => T | null)(data) : updater;
    // 本地更新成功后清 error（mutation 已成功，旧错误不再相关）
    error = null;
  }

  function reset(): void {
    seq++; // 让在途请求失效
    data = initialData;
    error = null;
    isLoading = false;
  }

  return {
    get data() {
      return data;
    },
    get error() {
      return error;
    },
    get isLoading() {
      return isLoading;
    },
    get status() {
      return status;
    },
    get hasData() {
      return hasData;
    },
    run,
    setData,
    reset,
  };
}
