<script lang="ts">
	import { Popover as PopoverPrimitive } from "bits-ui";
	import { getPortalTarget } from "$lib/app-scaffold/portal-context.svelte";

	let { ...restProps }: PopoverPrimitive.PortalProps = $props();

	const portalTarget = getPortalTarget();
</script>

<PopoverPrimitive.Portal {...restProps} to={portalTarget?.() ?? undefined} />
