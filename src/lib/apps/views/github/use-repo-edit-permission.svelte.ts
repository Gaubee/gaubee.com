import { getBranch, getRepo, type RepoPermissions } from "$lib/apps/installable/github/repo-api";
import { createResource } from "$lib/apps/installable/github/state";
/**
 * useRepoEditPermission：仓库编辑权限判定 hook（三层模型）。
 *
 * 2026-07-28 v2：修正「必须默认分支」的过度限制。
 * GitHub API 支持在任意活跃分支编辑（PUT contents?branch=xxx），
 * 仅 commit SHA（detached HEAD，不可变）和 tag（指向固定 commit）不可编辑。
 *
 * 三层判定（任一不通过即不可编辑）：
 * 1. push 权限：permissions?.push === true（GitHub API 真实权限）
 *    ✗ "你无权编辑此仓库"
 * 2. ref 是活跃分支（非 commit SHA / tag）：
 *    - 分支名（main/dev/feat-x）→ 可编辑
 *    - commit SHA（≥7 位 hex）→ 不可编辑 "历史版本不可编辑"
 *    - tag → 不可编辑 "tag 不可编辑"（getBranch 返回 null 识别）
 *    ✗ "切换到分支才能编辑"
 * 3. 当前分支未保护：getBranch(ref).protected === false
 *    ✗ "分支 {ref} 受保护，请通过 Pull Request 提交"
 *
 * 响应式：接收 getter 函数，hook 内部 $derived/$effect 调用建立依赖追踪。
 */
import { untrack } from "svelte";

/** useRepoEditPermission 的输入。 */
export interface UseRepoEditPermissionOptions {
  owner: string;
  repo: string;
  /** 当前 ref（分支名/commit SHA/tag）。空表示在默认分支。 */
  ref?: string;
  /** 外部注入的 permissions（模式 1：RepoDetailView 复用 repoInfo.permissions）。
   *  不传时 hook 自己查 getRepo（模式 2）。 */
  permissions?: RepoPermissions;
  /** 外部注入的默认分支（模式 1：复用 repoInfo.default_branch）。
   *  不传时 hook 自己查 getRepo。 */
  defaultBranch?: string;
}

/** useRepoEditPermission 的输出。 */
export interface RepoEditPermissionState {
  /** 是否可编辑（三层全通过）。 */
  canEdit: boolean;
  /** 不可编辑的原因（canEdit=true 时为 null）。 */
  disabledReason: string | null;
  /** 当前 token 对仓库的权限（加载后填充）。 */
  permissions: RepoPermissions | null;
  /** 仓库默认分支（加载后填充）。 */
  defaultBranch: string | null;
  /** 权限/分支信息是否正在加载。 */
  loading: boolean;
}

/** commit SHA 格式检测（≥7 位十六进制）。 */
const SHA_PATTERN = /^[0-9a-f]{7,40}$/i;

export function useRepoEditPermission(
  optsGetter: () => UseRepoEditPermissionOptions,
): RepoEditPermissionState {
  const opts = $derived(optsGetter());

  // ---- 模式判定：是否需要 hook 自己查 getRepo ----
  const needsRepoQuery = $derived(
    opts.permissions === undefined || opts.defaultBranch === undefined,
  );

  const repoInfo = createResource(() => getRepo(opts.owner, opts.repo), {
    initialData: null,
    silent: true,
  });

  const permissions = $derived(opts.permissions ?? repoInfo.data?.permissions ?? null);
  const defaultBranch = $derived(opts.defaultBranch ?? repoInfo.data?.default_branch ?? null);

  $effect(() => {
    void opts.owner;
    void opts.repo;
    if (needsRepoQuery) {
      void repoInfo.run();
    }
  });

  // ---- 实际 ref：opts.ref 优先，否则用默认分支 ----
  const effectiveRef = $derived((opts.ref ?? "") || defaultBranch || "");

  // ---- 第二层：ref 是活跃分支（非 commit SHA / tag）----
  // SHA 用正则识别；tag 通过 getBranch 返回 null 识别（在第三层查询时顺带判定）。
  // 注意：effectiveRef 为空或等于 defaultBranch 时一定是分支（可编辑）。
  const isCommitSha = $derived(SHA_PATTERN.test(effectiveRef));

  // ---- 第三层：当前分支的保护状态 ----
  // 查的是 effectiveRef 对应的分支（而非固定 defaultBranch）。
  // 如果 effectiveRef 是 tag，getBranch 返回 null → branchInfo=null → isTag=true。
  const branchProtection = createResource<{ protected: boolean; exists: boolean } | null>(
    () => {
      const ref = untrack(() => effectiveRef);
      if (!ref || isCommitSha) return Promise.resolve(null);
      return getBranch(opts.owner, opts.repo, ref).then((info) =>
        info ? { protected: info.protected, exists: true } : { protected: false, exists: false },
      );
    },
    { initialData: null, silent: true },
  );

  // 第一层：push 权限
  const hasPushPermission = $derived(permissions?.push === true);

  // 触发分支保护查询（仅有权限 + 非 SHA 时才查）
  $effect(() => {
    const hasPerm = hasPushPermission;
    void effectiveRef;
    if (hasPerm && !isCommitSha) {
      void branchProtection.run();
    } else {
      branchProtection.reset();
    }
  });

  // ---- 最终判定 ----
  const canEdit = $derived(
    hasPushPermission &&
      !isCommitSha &&
      branchProtection.data !== null && // 加载完成（非 null）
      branchProtection.data.exists && // ref 是有效分支（非 tag）
      !branchProtection.data.protected, // 分支未保护
  );

  const disabledReason = $derived.by<string | null>(() => {
    if (!hasPushPermission) return "你无权编辑此仓库";
    if (isCommitSha) return "历史版本不可编辑（commit SHA 只读）";
    // 等待分支保护查询结果
    if (branchProtection.data === null) return null; // 查询中，canEdit 自然 false（保守）
    if (!branchProtection.data.exists) return "tag 或不存在的分支不可编辑";
    if (branchProtection.data.protected) {
      return `分支 ${effectiveRef} 受保护，请通过 Pull Request 提交`;
    }
    return null;
  });

  const loading = $derived(
    (needsRepoQuery && repoInfo.isLoading) ||
      (hasPushPermission && !isCommitSha && branchProtection.data === null),
  );

  return {
    get canEdit() {
      return canEdit;
    },
    get disabledReason() {
      return disabledReason;
    },
    get permissions() {
      return permissions;
    },
    get defaultBranch() {
      return defaultBranch;
    },
    get loading() {
      return loading;
    },
  };
}
