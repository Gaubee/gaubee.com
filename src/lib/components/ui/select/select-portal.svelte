<script lang="ts">
	import { Select as SelectPrimitive } from "bits-ui";
	import { getPortalTarget } from "$lib/app-scaffold/portal-context.svelte";

	let { ...restProps }: SelectPrimitive.PortalProps = $props();

	const portalTarget = getPortalTarget();
</script>

<SelectPrimitive.Portal {...restProps} to={portalTarget?.() ?? undefined} />
