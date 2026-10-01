<script lang="ts">
	import { onDestroy } from 'svelte';

	// `rev` is the content key (the doc id): client navigates swap innerHTML
	// inside the SAME <article> node, so the element identity never changes
	// and this is the stable dep that re-runs rendering for the new doc.
	let { article = null, rev = '' }: { article: HTMLElement | null; rev?: string } = $props();

	const rendered = new Map<Element, { src: string; key: string; wrap: HTMLDivElement }>();
	let lastRev: string | null = null;
	let lastRoot: HTMLElement | null = null;
	let runId = 0;
	let uid = 0;
	let dead = false;
	let themeTimer: ReturnType<typeof setTimeout> | null = null;

	function themeKey(): string {
		const root = document.documentElement;
		return `${root.classList.contains('dark') ? 'dark' : 'light'}|${root.dataset.theme ?? ''}`;
	}

	async function renderAll() {
		// Every invocation invalidates older in-flight runs, so rapid theme
		// preview hovers collapse to the latest paint instead of racing.
		const my = ++runId;
		const root = article;
		if (!root || typeof document === 'undefined' || dead) return;
		// Drop entries orphaned by innerHTML swaps (client navigate/unlock);
		// their wraps went away with the old content.
		for (const [pre, info] of rendered) {
			if (my !== runId || dead) return;
			if (!pre.isConnected) {
				rendered.delete(pre);
				if (info.wrap.isConnected) info.wrap.remove();
			}
		}
		const blocks = root.querySelectorAll<HTMLElement>('pre.mermaid-block');
		if (!blocks.length) return;
		let mermaid: typeof import('mermaid').default;
		try {
			({ default: mermaid } = await import('mermaid'));
		} catch {
			return;
		}
		if (my !== runId || dead) return;

		const dark = document.documentElement.classList.contains('dark');
		let accent = '';
		try {
			accent = getComputedStyle(document.documentElement).getPropertyValue('--color-iris').trim();
		} catch {
			/* computed style unavailable: plain theme below */
		}
		try {
			mermaid.initialize({
				startOnLoad: false,
				securityLevel: 'strict',
				theme: dark ? 'dark' : 'default',
				...(accent
					? { themeVariables: { primaryColor: accent, primaryBorderColor: accent, lineColor: accent } }
					: {})
			});
		} catch {
			/* initialize failed: per-block try still runs, fallback keeps raw */
		}

		const key = themeKey();
		let n = 0;
		for (const pre of blocks) {
			if (my !== runId || dead) return;
			const code = pre.querySelector('code');
			const src = (code?.textContent ?? pre.textContent ?? '').trim();
			if (!src) continue;
			const prev = rendered.get(pre);
			if (prev && prev.src === src && prev.key === key && prev.wrap.isConnected) continue;
			prev?.wrap.remove();
			rendered.delete(pre);
			try {
				const { svg } = await mermaid.render(`mmd-${Date.now().toString(36)}-${uid++}-${n++}`, src);
				if (my !== runId || dead) return;
				const wrap = document.createElement('div');
				wrap.className = 'mermaid-diagram';
				wrap.setAttribute('role', 'img');
				wrap.setAttribute('aria-label', 'Diagram');
				wrap.innerHTML = svg;
				pre.after(wrap);
				pre.style.display = 'none';
				rendered.set(pre, { src, key, wrap });
			} catch {
				// Keep the raw code block visible, never a blank hole.
				pre.style.display = '';
			}
		}
	}

	// Trailing debounce: hover previews repaint data-theme many times per
	// second; only the settled theme gets a (costly) re-render. Pure DOM
	// work, zero state writes, so this can never feed an effect loop.
	function scheduleThemeRender() {
		if (themeTimer) clearTimeout(themeTimer);
		themeTimer = setTimeout(() => {
			themeTimer = null;
			void renderAll();
		}, 120);
	}

	// Re-run when the article swaps or the content key flips (same-node
	// innerHTML swap on client navigation) and on settled theme flips.
	// Tracked deps are exactly (article, rev); effects never run on server.
	$effect(() => {
		const root = article;
		void rev;
		if (!root) return;
		if (rev !== lastRev || root !== lastRoot) {
			rendered.clear();
			lastRev = rev;
			lastRoot = root;
		}
		void renderAll();
		const obs = new MutationObserver(scheduleThemeRender);
		obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
		return () => {
			runId++;
			obs.disconnect();
			if (themeTimer) {
				clearTimeout(themeTimer);
				themeTimer = null;
			}
		};
	});

	onDestroy(() => {
		dead = true;
		runId++;
		if (themeTimer) clearTimeout(themeTimer);
	});
</script>

<style>
	:global(.mermaid-diagram) {
		max-width: 100%;
		overflow-x: auto;
	}
	:global(.mermaid-diagram svg) {
		max-width: 100%;
		height: auto;
		display: block;
		margin-inline: auto;
	}
</style>
