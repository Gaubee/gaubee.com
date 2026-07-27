<!--
	RepoEditPermission：文件/变更编辑权限的判定状态机（render-less）。

	2026-07-28：取代旧的 isMainRepo = owner === OWNER && repo === REPO 硬编码判定。
	旧判定只认 gaubee/gaubee.com，忽略用户拥有的其它仓库（如 jixoai/openspecui）。

	判定模型（任一不通过即禁用）：

	1. push 权限：repoInfo.permissions?.push === true（GitHub API 真实权限）
	   ✗ "你无权编辑此仓库"
	   · permissions 来自 GET /repos/{owner}/{repo} 详情（列表/搜索端点不返回）
	   · undefined（未加载）时保守按「无权」处理，避免越权编辑
	2. ref 一致性：当前 ref（commitSha || branch）=== 仓库默认分支
	   ✗ "切换到 {branch} 分支才能编辑"
	3. 分支保护：当前 branch 的 protected === false（按需 getBranch 查询）
	   ✗ "分支 {branch} 受保护，请通过 Pull Request 提交"

	Render-less 设计：自身不渲染任何 UI，通过 children snippet 暴露
	{canEdit, disabledReason} 给父组件，由父组件决定按钮/Tooltip 具体形态。
	复用范式：RepoFileContent 编辑按钮 + RepoDetailView 变更 tab 提示。
-->
<script lang="ts">
  import type { Snippet } from 'svelte'
  import { untrack } from 'svelte'
  import { getBranch, type RepoPermissions } from '$lib/apps/installable/github/repo-api'
  import { createResource } from '$lib/apps/installable/github/state'

  let {
    owner,
    repo,
    permissions,
    branch,
    commitSha = '',
    children,
  }: {
    owner: string
    repo: string
    /** 当前 token 对该仓库的权限（来自 repoInfo.permissions，由 GET /repos/{o}/{r} 返回）。
     *  undefined 表示未加载，保守按「无 push 权限」处理。 */
    permissions?: RepoPermissions
    /** 仓库默认分支（repoInfo.default_branch）。 */
    branch: string
    /** 当前 ref（fileRef；可能是分支名/标签/SHA，空表示在默认分支）。 */
    commitSha?: string
    /** render snippet：接收 canEdit + disabledReason 两个独立值（保证响应性）。 */
    children: Snippet<[canEdit: boolean, disabledReason: string | null]>
  } = $props()

  /** 实际 ref：commitSha 优先（历史版本/其它分支），否则用默认分支。 */
  const effectiveRef = $derived(commitSha || branch)

  /** 第一层：push 权限（GitHub API 真实权限，取代旧的 owner/repo 硬编码）。
   *  permissions 未加载（undefined）时保守按无权处理，避免越权。 */
  const hasPushPermission = $derived(permissions?.push === true)

  /** 第二层：当前是否在默认分支（ref 与默认分支名一致才允许直接提交）。
   *  注意 commitSha 既可能是 commit SHA（历史版本），也可能是分支名（其它分支），
   *  两种都视为「不在默认分支」，统一直走第二层拦截。 */
  const isOnDefaultBranch = $derived(effectiveRef === branch)

  /** 第三层：默认分支的保护状态（仅有权限 + 在默认分支时按需查询）。
   *  protected=null 表示「未知」（查询中或查询失败），保守按「未保护」放行，
   *  避免网络问题导致有权限的仓库永远不可编辑。 */
  const branchProtection = createResource<boolean | null>(() => {
    const b = untrack(() => branch)
    return getBranch(owner, repo, b).then((info) => info?.protected ?? false)
  }, { initialData: null, silent: true })

  // 监听 branch 变化触发查询；只在前两层都通过时才查（避免无谓请求）
  $effect(() => {
    const hasPerm = hasPushPermission
    const onDefault = isOnDefaultBranch
    void branch
    if (hasPerm && onDefault) {
      void branchProtection.run()
    } else {
      branchProtection.reset()
    }
  })

  /** 是否可编辑（派生最终判定，供 snippet 读取）。 */
  const canEdit = $derived(
    hasPushPermission && isOnDefaultBranch && branchProtection.data !== true,
  )

  /** 不可编辑的原因（canEdit=true 时为 null）。 */
  const disabledReason = $derived.by<string | null>(() => {
    if (!hasPushPermission) return '你无权编辑此仓库'
    if (!isOnDefaultBranch) return `切换到 ${branch} 分支才能编辑`
    if (branchProtection.data === true) {
      return `分支 ${branch} 受保护，请通过 Pull Request 提交`
    }
    return null
  })
</script>

{@render children(canEdit, disabledReason)}
