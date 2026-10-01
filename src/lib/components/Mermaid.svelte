<script lang="ts">
	import { onDestroy } from 'svelte';

	let { article = null }: { article: HTMLElement | null } = $props();

	const rendered = new Map<Element, { src: string; key: string; wrap: HTMLDivElement }>();
	let lastRoot: HTMLElement | null = null;
	let runId = 0;
	let dead = false;

	function themeKey(): string {
		const root = document.documentElement;
		return `${root.classList.contains('dark') ? 'dark' : 'light'}|${root.dataset.theme ?? ''}`;
	}

	async function renderAll() {
		const root = article;
		if (!root || typeof document === 'undefined' || dead) return;
		if (root !== lastRoot) {
			rendered.clear();
			lastRoot = root;
		}
		const blocks = root.querySelectorAll<HTMLElement>('pre.mermaid-block');
		if (!blocks.length) return;
		const my = ++runId;
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
				const { svg } = await mermaid.render(`mmd-${Date.now().toString(36)}-${n++}`, src);
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

	// Re-run when the article swaps (same-component navigation) and whenever
	// the app theme flips. Effects never run on the server.
	$effect(() => {
		const root = article;
		if (root) void renderAll();
		const obs = new MutationObserver(() => void renderAll());
		obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
		return () => {
			runId++;
			obs.disconnect();
		};
	});

	onDestroy(() => {
		dead = true;
		runId++;
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
