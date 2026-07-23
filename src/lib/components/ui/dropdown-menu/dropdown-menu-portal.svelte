<script lang="ts">
	import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";
	import { getPortalTarget } from "$lib/app-scaffold/portal-context.svelte";

	let { ...restProps }: DropdownMenuPrimitive.PortalProps = $props();

	const portalTarget = getPortalTarget();
</script>

<DropdownMenuPrimitive.Portal
	{...restProps}
	to={portalTarget?.() ?? undefined}
/>
