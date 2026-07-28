<!--
	RepoEditPermission：文件/变更编辑权限的判定状态机（render-less wrapper）。

	2026-07-28：判定逻辑已抽到 useRepoEditPermission.svelte.ts hook，本组件仅作
	render-less wrapper（消费 hook + 通过 children snippet 暴露 canEdit/disabledReason）。
	EditorView 等非组件上下文可直接用 hook。

	判定模型（任一不通过即禁用）：
	1. push 权限：permissions.push === true（GitHub API 真实权限）
	2. ref 一致性：当前 ref === 默认分支
	3. 分支保护：getBranch 查 protected === false

	两种模式：
	- 外部注入 permissions + branch（RepoDetailView 复用 repoInfoResource）
	- hook 自己查 getRepo（hook 内部按需）
-->
<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { RepoPermissions } from '$lib/apps/installable/github/repo-api'
  import { useRepoEditPermission } from './use-repo-edit-permission.svelte'

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
    /** 外部注入的权限（来自 repoInfo.permissions）。不传时 hook 自己查 getRepo。 */
    permissions?: RepoPermissions
    /** 仓库默认分支（repoInfo.default_branch）。不传时 hook 自己查 getRepo。 */
    branch?: string
    /** 当前 ref（fileRef；可能是分支名/标签/SHA，空表示在默认分支）。 */
    commitSha?: string
    /** render snippet：接收 canEdit + disabledReason 两个独立值。 */
    children: Snippet<[canEdit: boolean, disabledReason: string | null]>
  } = $props()

  const perm = useRepoEditPermission(() => ({
    owner,
    repo,
    ref: commitSha,
    permissions,
    defaultBranch: branch,
  }))
</script>

{@render children(perm.canEdit, perm.disabledReason)}
