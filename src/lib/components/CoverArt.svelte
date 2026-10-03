<script lang="ts">
	import { onMount } from 'svelte';
	import { renderCoverSVG, hashSeed, DEFAULT_COVER_PALETTE, type CoverPalette } from '$lib/cover';

	interface Props {
		/** String to hash into the seed (doc id, pathname, …). */
		seedText: string;
		/** Logical canvas of the generated field (stretched to fit). */
		width?: number;
		height?: number;
		class?: string;
	}

	let { seedText, width = 1200, height = 140, class: cls = '' }: Props = $props();

	// First paint (SSR + hydration) uses the fixed dark default palette;
	// the mount effect immediately re-renders in the viewer's theme colors.
	// Capturing the initial props here is intentional: this is only the
	// pre-hydration frame, the effect below owns every later repaint.
	// svelte-ignore state_referenced_locally
	let svg = $state(renderCoverSVG(hashSeed(seedText), { width, height }));
	let themeTimer: ReturnType<typeof setTimeout> | null = null;

	function readPalette(): CoverPalette {
		const css = getComputedStyle(document.documentElement);
		const pick = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
		return {
			bg: pick('--color-paper', DEFAULT_COVER_PALETTE.bg),
			ink: pick('--color-ink', DEFAULT_COVER_PALETTE.ink),
			accent: pick('--color-iris', DEFAULT_COVER_PALETTE.accent)
		};
	}

	function paint() {
		svg = renderCoverSVG(hashSeed(seedText), { width, height, palette: readPalette() });
	}

	// Trailing debounce: rapid theme preview hovers fire data-theme
	// mutations many times per second; only the settled theme repaints.
	function scheduleRepaint() {
		if (themeTimer) clearTimeout(themeTimer);
		themeTimer = setTimeout(() => {
			themeTimer = null;
			paint();
		}, 150);
	}

	onMount(() => {
		const obs = new MutationObserver(scheduleRepaint);
		obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
		return () => {
			obs.disconnect();
			if (themeTimer) {
				clearTimeout(themeTimer);
				themeTimer = null;
			}
		};
	});

	// Re-paint when the seed or canvas changes — component instances are
	// reused across client navigations, so a doc swap must swap the field.
	// paint() reads the props here, which registers them as the only deps;
	// it writes only `svg`, so this cannot loop.
	$effect(() => {
		paint();
	});
</script>

<div class={`cover-art ${cls}`} aria-hidden="true">
	{@html svg}
</div>

<style>
	/* The generated SVG carries its own width/height attributes; CSS
	   stretches it to the wrapper, and non-scaling strokes keep the
	   hairlines crisp at any size. */
	.cover-art :global(svg) {
		display: block;
		width: 100%;
		height: 100%;
	}
</style>
