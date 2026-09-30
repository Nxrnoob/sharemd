<script lang="ts">
	import { onMount } from 'svelte';
	import { codeCopy } from '$lib/actions/codeCopy';
	import { copyText } from '$lib/clipboard';
	import Toast from '$lib/components/Toast.svelte';
	import TocRail from '$lib/components/TocRail.svelte';
	import TocFloating from '$lib/components/TocFloating.svelte';
	import BackToTop from '$lib/components/BackToTop.svelte';
	import ReadingProgress from '$lib/components/ReadingProgress.svelte';
	import {
		buildThemedUrl,
		getThemeFromUrl,
		applySessionTheme,
		isThemeId,
		DEFAULT_THEME_ID
	} from '$lib/themes';
	import type { ThemeId } from '$lib/themes';

	let { data } = $props();

	let toast = $state<string | null>(null);
	let toastTimer: ReturnType<typeof setTimeout> | null = null;
	let toc = $state<{ id: string; text: string; level: number }[]>([]);
	let activeId = $state<string | null>(null);
	let articleEl = $state<HTMLElement | null>(null);
	let tocOpen = $state(false);
	// Theme actually on screen (link override or viewer pick). Buttons always
	// share what is on screen.
	let screenTheme = $state<ThemeId>(DEFAULT_THEME_ID);

	const themedPath = $derived(buildThemedUrl(`/s/${data.id}`, screenTheme));
	const themedRawPath = $derived(buildThemedUrl(`/s/${data.id}/raw`, screenTheme));
	const shareUrl = $derived(typeof location !== 'undefined' ? new URL(themedPath, location.origin).href : themedPath);
	const dateLabel = $derived(
		new Date(data.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
	);
	const plainDescription = $derived(
		articleEl?.innerText.slice(0, 160).replace(/\s+/g, ' ').trim() ||
			`${data.title}. Shared with ShareMD.`
	);

	function flash(msg: string) {
		if (toastTimer) clearTimeout(toastTimer);
		toast = msg;
		toastTimer = setTimeout(() => (toast = null), 2600);
	}

	function toggleToc() {
		tocOpen = !tocOpen;
		// Keep the site header visible while the accordion is open.
		if (tocOpen) document.documentElement.dataset.tocOpen = 'true';
		else delete document.documentElement.dataset.tocOpen;
	}

	async function copyLink() {
		if (await copyText(shareUrl)) {
			flash('Link copied. Paste it anywhere.');
		} else {
			flash('Copy failed. Copy the address bar URL instead.');
		}
	}

	async function download() {
		try {
			const res = await fetch(themedRawPath);
			if (!res.ok) throw new Error();
			const text = await res.text();
			const blob = new Blob([text], { type: 'text/markdown' });
			const a = document.createElement('a');
			a.href = URL.createObjectURL(blob);
			a.download = `${data.id}.md`;
			document.body.appendChild(a);
			a.click();
			a.remove();
			setTimeout(() => URL.revokeObjectURL(a.href), 4000);
		} catch {
			flash('Download failed. Try the raw link instead.');
		}
	}

	onMount(() => {
		// Link theme override (?theme=): session-only, viewer storage untouched.
		// The init script already painted it pre-paint; sync state here.
		const override = getThemeFromUrl(window.location.search);
		if (override) {
			applySessionTheme(override);
			screenTheme = override;
		} else {
			const ds = document.documentElement.dataset.theme;
			screenTheme = isThemeId(ds) ? ds : DEFAULT_THEME_ID;
		}

		// Follow later viewer picks (ThemePicker) so buttons share the screen.
		const themeObs = new MutationObserver(() => {
			const ds = document.documentElement.dataset.theme;
			if (isThemeId(ds)) screenTheme = ds;
		});
		themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
		// Derive TOC from the server-rendered headings (ids are user-content-*).
		// No markdown re-parse: avoids hydration mismatch.
		if (!articleEl) return;
		const heads = Array.from(articleEl.querySelectorAll('h1[id], h2[id], h3[id]')).slice(0, 20);
		toc = heads
			.map((h) => ({
				id: h.id,
				text: (h.textContent ?? '').trim().slice(0, 80),
				level: h.tagName === 'H1' ? 1 : h.tagName === 'H2' ? 2 : 3
			}))
			.filter((t) => t.id && t.text);
		activeId = toc[0]?.id ?? null;

		// Scrollspy: highlight the heading nearest the top of the viewport.
		const spy = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting) activeId = entry.target.id;
				}
			},
			{ rootMargin: '-72px 0px -75% 0px', threshold: 0 }
		);
		heads.forEach((h) => spy.observe(h));
		return () => {
			spy.disconnect();
			themeObs.disconnect();
			delete document.documentElement.dataset.tocOpen;
		};
	});
</script>

<svelte:head>
	<title>{data.title} · ShareMD</title>
	<meta name="description" content={plainDescription} />
	<meta property="og:title" content={data.title} />
	<meta property="og:description" content={plainDescription} />
	<meta property="og:type" content="article" />
	<meta name="twitter:card" content="summary" />
	<meta name="twitter:title" content={data.title} />
	<meta name="twitter:description" content={plainDescription} />
</svelte:head>

<ReadingProgress getTarget={() => articleEl} />

<!-- top bar -->
<div class="border-b border-line bg-surface/80 backdrop-blur dark:border-night-line dark:bg-night-surface/80">
	<div class="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-6 lg:max-w-7xl">
		<div class="min-w-0 flex-1">
			<h1 class="font-display truncate text-[17px] font-semibold tracking-tight">{data.title}</h1>
			<p class="mt-0.5 font-mono text-[11px] text-ink-soft dark:text-slate-500">
				{dateLabel} · {data.views} {data.views === 1 ? 'view' : 'views'} · {data.readTime}
			</p>
		</div>
		<div class="flex shrink-0 items-center gap-1.5">
			<button
				onclick={copyLink}
				class="rounded-xl border border-line px-3 py-1.5 text-[13px] font-medium transition hover:border-iris hover:text-iris dark:border-night-line dark:hover:border-indigo-300 dark:hover:text-indigo-200"
			>
				Copy link
			</button>
			<a
				href={themedRawPath}
				class="rounded-xl border border-line px-3 py-1.5 text-[13px] font-medium transition hover:border-iris hover:text-iris dark:border-night-line dark:hover:border-indigo-300 dark:hover:text-indigo-200"
			>
				Raw
			</a>
			<button
				onclick={download}
				class="btn-accent rounded-xl px-3 py-1.5 text-[13px] font-medium transition"
			>
				Download .md
			</button>
		</div>
	</div>
	{#if toc.length >= 3}
		<div class="mx-auto w-full max-w-3xl px-4 pb-3 sm:px-6 lg:hidden">
			<button
				onclick={toggleToc}
				aria-expanded={tocOpen}
				class="font-mono text-[11px] tracking-wide text-ink-soft uppercase hover:text-iris dark:text-slate-500"
			>
				{tocOpen ? 'Hide contents' : `+ Contents (${toc.length})`}
			</button>
			{#if tocOpen}
				<nav aria-label="Table of contents">
					<ul class="mt-2 space-y-1 border-l-2 border-line pl-3 dark:border-night-line">
						{#each toc as t}
							<li class={t.level === 3 ? 'pl-4' : t.level === 2 ? 'pl-2' : ''}>
								<a
									href={`#${t.id}`}
									class="block truncate text-[13px] text-ink-soft hover:text-iris hover:underline hover:underline-offset-2 dark:text-slate-400 dark:hover:text-indigo-300"
									>{t.text}</a
								>
							</li>
						{/each}
					</ul>
				</nav>
			{/if}
		</div>
	{/if}
</div>

<!-- article -->
<main class="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-10 lg:max-w-7xl">
	<div class="lg:grid lg:grid-cols-[minmax(0,1fr)_280px] lg:gap-12">
		<div class="min-w-0">
			<article
				bind:this={articleEl}
				use:codeCopy
				class="prose prose-share rise max-w-none sm:prose-lg dark:prose-invert"
			>
				{@html data.html}
			</article>
			<div class="mt-10 flex items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3 dark:border-night-line dark:bg-night-surface">
				<p class="text-[13px] text-ink-soft dark:text-slate-500">Unlisted. Anyone with the link can read.</p>
				<a href="/" class="shrink-0 text-sm font-medium text-iris hover:underline hover:underline-offset-2 dark:text-indigo-300">Share your own →</a>
			</div>
		</div>
		<TocRail items={toc} activeId={activeId} />
	</div>
</main>

<Toast message={toast} />
<TocFloating items={toc} activeId={activeId} />
<BackToTop />
