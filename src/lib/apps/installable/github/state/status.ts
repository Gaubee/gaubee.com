/**
 * 异步资源状态机（纯函数，不依赖 runes，server project 可测）。
 *
 * 8 种拓扑状态（对照系统提示词「全生命周期状态机」）：
 *
 *   无数据区：idle（未加载）/ loading（加载中）/ error（异常） / empty（空态）
 *   有数据区：success（已加载）/ refreshing（更新中）/ stale-error（异常但保留旧数据）
 *   （idle 兼属无数据区，共 7 种有效状态值，对应 8 种拓扑的 idle 跨区）
 *
 * 派生规则（按优先级，消除手写 `loading && data.length === 0` 判断）：
 *
 *   isLoading + hasData  → refreshing   （背景刷新，保留旧数据，不闪骨架）
 *   isLoading + !hasData → loading      （首次加载，骨架占位）
 *   error    + hasData  → stale-error   （网络抖动，保留旧数据 + 错误条）
 *   error    + !hasData → error         （首屏失败，错误占位）
 *   !error   + isEmpty  → empty         （已加载但列表空）
 *   !error   + hasData  → success       （正常）
 *   其余                 → idle          （未触发 run）
 *
 * 注意：stale-error 不清空 data —— 网络抖动时用户仍能看旧数据，仅顶部出错误条 + 重试。
 */

/** 资源状态（7 个有效值，idle 兼跨无数据区）。 */
export type ResourceStatus =
  | "idle"
  | "loading"
  | "refreshing"
  | "success"
  | "empty"
  | "error"
  | "stale-error";

/** 派生状态机的输入（data/error/isLoading 三元 + 可选 isEmpty 判定）。 */
export interface ResourceStatusInput<T> {
  data: T | null;
  error: string | null;
  isLoading: boolean;
  /** 是否「有数据」（列表/单值语义不同，由调用方决定：列表看 length，单值看非 null）。 */
  hasData: boolean;
  /** 列表空态判定（默认恒 false，即单值资源无 empty 态）。 */
  isEmpty?: (data: T) => boolean;
}

/** 由 data/error/isLoading 派生当前状态（纯函数）。 */
export function deriveStatus<T>(input: ResourceStatusInput<T>): ResourceStatus {
  const { data, error, isLoading, hasData, isEmpty } = input;

  if (isLoading) {
    return hasData ? "refreshing" : "loading";
  }
  if (error) {
    return hasData ? "stale-error" : "error";
  }
  if (hasData) {
    // 有数据且无错误：检查是否空态（仅列表资源配置了 isEmpty 时可能为 empty）。
    // data 此处非 null（hasData 为真），断言为 T 满足 isEmpty 签名。
    return isEmpty && data !== null && isEmpty(data) ? "empty" : "success";
  }
  return "idle";
}

/** status 是否处于「加载中」（loading 或 refreshing）。 */
export function isPendingStatus(status: ResourceStatus): boolean {
  return status === "loading" || status === "refreshing";
}

/** status 是否处于「异常」（error 或 stale-error）。 */
export function isErrorStatus(status: ResourceStatus): boolean {
  return status === "error" || status === "stale-error";
}

/** status 是否「有数据可渲染」（success / empty / refreshing / stale-error）。 */
export function hasRenderableData(status: ResourceStatus): boolean {
  return (
    status === "success" ||
    status === "empty" ||
    status === "refreshing" ||
    status === "stale-error"
  );
}
