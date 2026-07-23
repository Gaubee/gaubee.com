<script lang="ts">
	import { Tooltip as TooltipPrimitive } from "bits-ui";
	import { getPortalTarget } from "$lib/app-scaffold/portal-context.svelte";

	let { ...restProps }: TooltipPrimitive.PortalProps = $props();

	const portalTarget = getPortalTarget();
</script>

<TooltipPrimitive.Portal {...restProps} to={portalTarget?.() ?? undefined} />
