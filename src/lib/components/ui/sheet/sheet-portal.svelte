<script lang="ts">
	import { Dialog as SheetPrimitive } from "bits-ui";
	import { getPortalTarget } from "$lib/app-scaffold/portal-context.svelte";

	let { ...restProps }: SheetPrimitive.PortalProps = $props();

	const portalTarget = getPortalTarget();
</script>

<SheetPrimitive.Portal {...restProps} to={portalTarget?.() ?? undefined} />
