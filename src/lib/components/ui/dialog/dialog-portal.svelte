<script lang="ts">
	import { Dialog as DialogPrimitive } from "bits-ui";
	import { getPortalTarget } from "$lib/app-scaffold/portal-context.svelte";

	let { ...restProps }: DialogPrimitive.PortalProps = $props();

	// 锚定到当前 AppShell 的 portal root（若有），避免逃逸到 document.body。
	// 在 AppShell 外（shell 级组件）getPortalTarget 返回 undefined → fallback body。
	const portalTarget = getPortalTarget();
</script>

<DialogPrimitive.Portal {...restProps} to={portalTarget?.() ?? undefined} />
