import { getBranch, getRepo, type RepoPermissions } from "$lib/apps/installable/github/repo-api";
import { createResource } from "$lib/apps/installable/github/state";
/**
 * useRepoEditPermission：仓库编辑权限判定 hook（三层模型）。
 *
 * 2026-07-28：从 RepoEditPermission.svelte 抽出，让 EditorView（非组件上下文）也能复用。
 *
 * 三层判定（任一不通过即不可编辑）：
 * 1. push 权限：permissions?.push === true（GitHub API 真实权限）
 *    ✗ "你无权编辑此仓库"
 * 2. ref 一致性：当前 ref === 默认分支
 *    ✗ "切换到 {branch} 分支才能编辑"
 * 3. 分支保护：当前 branch 的 protected === false（按需 getBranch 查询）
 *    ✗ "分支 {branch} 受保护，请通过 Pull Request 提交"
 *
 * 响应式：接收 getter 函数（返回 UseRepoEditPermissionOptions），hook 内部用
 * $derived/$effect 调用 getter 建立依赖追踪。owner/repo/ref 变化时自动重查。
 *
 * @example
 * // 模式 1：外部注入（RepoDetailView 复用 repoInfoResource）
 * const perm = useRepoEditPermission(() => ({ owner, repo, ref: fileRef, permissions: repoInfo?.permissions, defaultBranch: repoInfo?.default_branch }))
 *
 * @example
 * // 模式 2：hook 自己查 getRepo（EditorView raw 模式）
 * const perm = useRepoEditPermission(() => target?.kind === 'raw' ? { owner: target.owner, repo: target.repo, ref: target.ref } : { owner: '', repo: '' })
 */
import { untrack } from "svelte";

/** useRepoEditPermission 的输入。 */
export interface UseRepoEditPermissionOptions {
  owner: string;
  repo: string;
  /** 当前 ref（可能是分支名/标签/SHA）。空表示在默认分支。 */
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

export function useRepoEditPermission(
  optsGetter: () => UseRepoEditPermissionOptions,
): RepoEditPermissionState {
  // 派生当前 opts（响应式追踪 owner/repo/ref/permissions/branch 变化）
  const opts = $derived(optsGetter());

  // ---- 模式判定：是否需要 hook 自己查 getRepo ----
  const needsRepoQuery = $derived(
    opts.permissions === undefined || opts.defaultBranch === undefined,
  );

  // getRepo 资源（仅模式 2 触发）：拿 permissions + default_branch
  const repoInfo = createResource(() => getRepo(opts.owner, opts.repo), {
    initialData: null,
    silent: true,
  });

  // 实际生效的 permissions / defaultBranch（优先外部注入，否则取 getRepo 结果）
  const permissions = $derived(opts.permissions ?? repoInfo.data?.permissions ?? null);
  const defaultBranch = $derived(opts.defaultBranch ?? repoInfo.data?.default_branch ?? null);

  // 触发 getRepo 查询（仅模式 2 + owner/repo 变化时）
  $effect(() => {
    void opts.owner;
    void opts.repo;
    if (needsRepoQuery) {
      void repoInfo.run();
    }
  });

  // ---- 第三层：分支保护状态（仅有权限 + 在默认分支时按需查询）----
  const branchProtection = createResource<boolean | null>(
    () => {
      const b = untrack(() => defaultBranch);
      if (!b) return Promise.resolve(null);
      return getBranch(opts.owner, opts.repo, b).then((info) => info?.protected ?? false);
    },
    { initialData: null, silent: true },
  );

  // 实际 ref：opts.ref 优先，否则用默认分支
  const effectiveRef = $derived((opts.ref ?? "") || defaultBranch || "");

  // 第一层：push 权限（permissions 未加载时保守按无权处理）
  const hasPushPermission = $derived(permissions?.push === true);

  // 第二层：当前是否在默认分支
  // 注意：defaultBranch 未加载时（null），effectiveRef 不可能与 null 相等，自然落入「非默认分支」分支
  // 但此时判定是保守的——等 defaultBranch 加载后会重新派生
  const isOnDefaultBranch = $derived(defaultBranch !== null && effectiveRef === defaultBranch);

  // 触发分支保护查询（仅前两层通过时才查，避免无谓请求）
  $effect(() => {
    const hasPerm = hasPushPermission;
    const onDefault = isOnDefaultBranch;
    void defaultBranch;
    if (hasPerm && onDefault) {
      void branchProtection.run();
    } else {
      branchProtection.reset();
    }
  });

  // ---- 最终判定 ----
  const canEdit = $derived(
    hasPushPermission && isOnDefaultBranch && branchProtection.data !== true,
  );

  const disabledReason = $derived.by<string | null>(() => {
    if (!hasPushPermission) return "你无权编辑此仓库";
    if (!isOnDefaultBranch) {
      return defaultBranch ? `切换到 ${defaultBranch} 分支才能编辑` : "正在加载仓库信息…";
    }
    if (branchProtection.data === true) {
      return `分支 ${defaultBranch} 受保护，请通过 Pull Request 提交`;
    }
    return null;
  });

  const loading = $derived(
    (needsRepoQuery && repoInfo.isLoading) ||
      (hasPushPermission && isOnDefaultBranch && branchProtection.isLoading),
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
