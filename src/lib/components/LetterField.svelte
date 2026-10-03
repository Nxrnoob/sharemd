<script lang="ts">
	import { onMount } from 'svelte';
	// Scribble face: Caveat 600, self-hosted via Fontsource (OFL),
	// bundled by Vite — zero external requests. Imported here (not
	// globally) so the woff2 only ever ships on the landing chunk.
	import '@fontsource/caveat/latin-600.css';
	import { createLetterField, LETTER_FIELD_CANVAS_CSS } from '../../../art/letter-field.js';

	// Letter Field — ghost letters of what the user types.
	//
	// LAYERING (hard-won rule, do not "simplify"): `body` paints opaque
	// `background: var(--color-paper)` (see layout.css), so this canvas must
	// composite ABOVE it as a direct <body> child —
	//   position:fixed; inset:0; z-index:0; pointer-events:none
	// (LETTER_FIELD_CANVAS_CSS, applied below) — while the app root carries
	// `relative z-10` and paints above the canvas. Declaring the <canvas> in
	// a template would trap it inside that stacking context (where it would
	// overlay panel surfaces instead of glowing behind them), so the node is
	// created here and prepended to <body> imperatively, then removed on
	// teardown. It is fully transparent: cleared, never filled.
	//
	// The canvas is aria-hidden and pointer-transparent: pure atmosphere,
	// never content, never interactive.

	let field: ReturnType<typeof createLetterField> | null = null;
	// 40ms gate for the all-keys path below (mirrors the Markdown input
	// path's gate in +page.svelte). Plain let: never rendered, no reactivity.
	let lastKeyPlant = 0;

	/** Plant literal input characters as ghost glyphs. No-op until mounted. */
	export function plant(text: string): void {
		field?.plant(text);
	}

	onMount(() => {
		const canvas = document.createElement('canvas');
		canvas.dataset.letterField = 'true';
		canvas.setAttribute('aria-hidden', 'true');
		canvas.style.cssText = LETTER_FIELD_CANVAS_CSS;
		// Sibling BELOW the app stacking context (root `relative z-10`).
		document.body.prepend(canvas);

		const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
		field = createLetterField(canvas, { reducedMotion: motionQuery.matches });

		const onResize = () => field?.resize();
		window.addEventListener('resize', onResize, { passive: true });

		// Tab-hidden pause: freeze glyph ages instead of letting them
		// fade unseen in a background tab.
		const onVisibility = () => field?.setPaused(document.hidden);
		document.addEventListener('visibilitychange', onVisibility);

		const onMotion = (e: MediaQueryListEvent) => field?.setReducedMotion(e.matches);
		motionQuery.addEventListener('change', onMotion);

		// All-keys hook, landing scope is automatic: this component mounts
		// only on the landing page. Printable keydowns plant their literal
		// character — near the focused input when focus sits in one (Title,
		// slug, password, max-views), scattered viewport-wide otherwise.
		// The Markdown textarea is SKIPPED: its input path already plants
		// with burst scaling, and planting here too would double every
		// keystroke. Modifiers, controls, and whitespace plant nothing.
		const onKey = (e: KeyboardEvent) => {
			if (e.ctrlKey || e.metaKey || e.altKey) return;
			if (typeof e.key !== 'string' || e.key.length !== 1 || e.key.trim() === '') return;
			if (e.target instanceof HTMLTextAreaElement) return;
			const now = performance.now();
			if (now - lastKeyPlant < 40) return;
			lastKeyPlant = now;
			const active = document.activeElement;
			const anchor = active instanceof HTMLInputElement ? active : undefined;
			try {
				field?.plant(e.key, anchor);
			} catch {
				/* decorative only: keys must never fail because art did */
			}
		};
		window.addEventListener('keydown', onKey);

		// Theme retint with zero state writes: this callback never assigns
		// to component state, so rapid ThemePicker preview hovers (many
		// data-theme mutations per second) repaint only the bitmap and can
		// never loop. The sketch reads live CSS vars; no stored colors here.
		const observer = new MutationObserver(() => {
			field?.retint();
		});
		observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ['data-theme', 'class']
		});

		// Warm the palette in case the first paint raced the observer.
		field?.retint();

		return () => {
			window.removeEventListener('resize', onResize);
			window.removeEventListener('keydown', onKey);
			document.removeEventListener('visibilitychange', onVisibility);
			motionQuery.removeEventListener('change', onMotion);
			observer.disconnect();
			field?.destroy();
			field = null;
		};
	});
</script>
