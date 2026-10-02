<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { createInkyDrift } from '../../../art/inky-drift.js';

	interface DriftTokens {
		bg: string;
		ink: string;
		accent: string;
	}

	let host: HTMLDivElement | null = $state(null);
	let drift: {
		mount: () => void;
		updateTheme: (t: DriftTokens, id: string) => void;
		pause: () => void;
		resume: () => void;
		pulse?: (nx: number, ny: number) => void;
		destroy: () => void;
	} | null = null;
	let themeTimer: ReturnType<typeof setTimeout> | null = null;
	let dead = false;

	function readTokens(): DriftTokens {
		const css = getComputedStyle(document.documentElement);
		const pick = (name: string, fallback: string) =>
			css.getPropertyValue(name).trim() || fallback;
		return {
			bg: pick('--color-paper', '#000000'),
			ink: pick('--color-ink', '#f5f5f5'),
			accent: pick('--color-iris', '#ffffff')
		};
	}

	function currentThemeId(): string {
		return document.documentElement.dataset.theme || 'monochrome';
	}

	// Trailing debounce: rapid preview hovers repaint data-theme many times
	// per second; only the settled theme gets a (costly) reseed. Pure paint,
	// zero state writes, so this can never feed an effect loop.
	function scheduleReseed() {
		if (themeTimer) clearTimeout(themeTimer);
		themeTimer = setTimeout(() => {
			themeTimer = null;
			if (!dead) drift?.updateTheme(readTokens(), currentThemeId());
		}, 150);
	}

	function onVisible() {
		if (document.hidden) drift?.pause();
		else drift?.resume();
	}

	/** Keystroke echo: forward a normalized (0..1) burst point to the field. */
	export function pulse(nx: number, ny: number) {
		drift?.pulse?.(nx, ny);
	}

	onMount(() => {
		if (!host || typeof document === 'undefined') return;
		let cancelled = false;
		const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		(async () => {
			let P5: unknown;
			try {
				({ default: P5 } = await import('p5'));
			} catch {
				return;
			}
			if (cancelled || dead || !host) return;
			drift = createInkyDrift(
				P5 as new (sketch: (p: never) => void, node: HTMLElement) => unknown,
				host,
				{ tokens: readTokens(), themeId: currentThemeId(), reducedMotion: reduced }
			);
			drift.mount();
		})();
		const obs = new MutationObserver(scheduleReseed);
		obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
		document.addEventListener('visibilitychange', onVisible);
		return () => {
			cancelled = true;
			obs.disconnect();
			document.removeEventListener('visibilitychange', onVisible);
			if (themeTimer) {
				clearTimeout(themeTimer);
				themeTimer = null;
			}
		};
	});

	onDestroy(() => {
		dead = true;
		if (themeTimer) clearTimeout(themeTimer);
		drift?.destroy();
		drift = null;
	});
</script>

<div
	bind:this={host}
	aria-hidden="true"
	class="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
></div>
