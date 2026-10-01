<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { codeCopy } from '$lib/actions/codeCopy';
	import { copyText } from '$lib/clipboard';
	import Toast from '$lib/components/Toast.svelte';
	import TocRail from '$lib/components/TocRail.svelte';
	import TocFloating from '$lib/components/TocFloating.svelte';
	import BackToTop from '$lib/components/BackToTop.svelte';
	import ReadingProgress from '$lib/components/ReadingProgress.svelte';
	import Mermaid from '$lib/components/Mermaid.svelte';
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
	// Password gate state. Backend may return { passwordRequired: true } with
	// no content, or { gone: true } for expired/used-up links.
	let pwInput = $state('');
	let pwBusy = $state(false);
	let pwError = $state<string | null>(null);
	let unlockTried = $state(false);
	// True between submit and the refreshed load data landing. The error is
	// only ever set from the *latest* completed attempt, never the flight.
	let unlockPending = $state(false);

	type LoadFlags = { passwordRequired?: boolean; gone?: boolean };
	const flags = $derived((data ?? {}) as typeof data & LoadFlags);
	const isGone = $derived(flags.gone === true);
	const isGated = $derived(!isGone && flags.passwordRequired === true);
	const gateError = $derived(
		pwError ?? (unlockTried && isGated ? 'Wrong password. Try again.' : null)
	);

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

	async function unlock() {
		pwError = null;
		unlockTried = false;
		if (!pwInput.trim()) {
			pwError = 'Type the password first.';
			return;
		}
		unlockPending = true;
		pwBusy = true;
		try {
			// Keep ?theme= (and anything else) while adding ?pw=.
			const params = new URLSearchParams(page.url.search);
			params.set('pw', pwInput);
			await goto(`${page.url.pathname}?${params.toString()}`, { invalidateAll: true });
		} finally {
			pwBusy = false;
		}
	}

	// Resolve the pending attempt once fresh load data arrives: a still-gated
	// doc means the latest attempt failed; an unlocked doc clears silently,
	// so a correct password never flashes the error on its way in.
	$effect(() => {
		void data;
		if (!unlockPending) return;
		unlockPending = false;
		if (isGated) unlockTried = true;
	});

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
		// Compare-then-bail: setAttribute fires the observer even when the
		// value is unchanged, and that must never churn screenTheme (which
		// feeds the share-URL deriveds) on its own.
		const themeObs = new MutationObserver(() => {
			const ds = document.documentElement.dataset.theme;
			if (isThemeId(ds) && screenTheme !== ds) screenTheme = ds;
		});
		themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
		return () => {
			themeObs.disconnect();
			delete document.documentElement.dataset.tocOpen;
		};
	});

	// Client navigates reuse this component instance, so onMount does NOT
	// re-run for the second doc. Re-sync the screen theme when the doc or
	// query string swaps. The DOM paint is fire-and-forget (zero state
	// writes); the state set is compare-then-bail with untracked reads, so
	// the only tracked deps are (data.id, page.url.search) and it settles.
	$effect(() => {
		void data.id;
		const search = page.url.search;
		const override = getThemeFromUrl(search);
		if (override) {
			if (document.documentElement.dataset.theme !== override) applySessionTheme(override);
			if (untrack(() => screenTheme) !== override) screenTheme = override;
		} else {
			const ds = document.documentElement.dataset.theme;
			if (isThemeId(ds) && untrack(() => screenTheme) !== ds) screenTheme = ds;
		}
	});

	// Rebuild the TOC whenever the article element renders or the unlocked
	// content swaps in. goto(invalidateAll) reuses this component instance,
	// so onMount does NOT re-run after unlock: without this effect the rail
	// and floating TOC would stay empty on newly unlocked docs.
	$effect(() => {
		const el = articleEl;
		const html = data.html;
		if (!el || !html) {
			if (untrack(() => toc).length) toc = [];
			if (untrack(() => activeId) !== null) activeId = null;
			return;
		}
		// h1-h3 only by design; skip anything inside <pre> (code text, never
		// a real heading); dedupe ids so each anchor is unique. No count cap:
		// every real heading appears.
		const seen = new Set<string>();
		const heads = Array.from(el.querySelectorAll('h1[id], h2[id], h3[id]')).filter(
			(h) => !h.closest('pre')
		);
		const next = heads
			.map((h) => ({
				id: h.id,
				text: (h.textContent ?? '').trim().slice(0, 80),
				level: h.tagName === 'H1' ? 1 : h.tagName === 'H2' ? 2 : 3
			}))
			.filter((t) => {
				if (!t.id || !t.text || seen.has(t.id)) return false;
				seen.add(t.id);
				return true;
			});
		// Compare-then-bail with untracked reads: deps stay exactly
		// (articleEl, data.html), so assigning here can never retrigger.
		const prev = untrack(() => toc);
		const same =
			prev.length === next.length &&
			next.every((t, i) => t.id === prev[i].id && t.text === prev[i].text && t.level === prev[i].level);
		if (!same) toc = next;
		const first = next[0]?.id ?? null;
		if (untrack(() => activeId) !== first) activeId = first;

		// Scrollspy: highlight the heading nearest the top of the viewport.
		// Guarded writes: repeat intersections of the same heading never
		// churn state (this callback is outside reactive tracking anyway).
		const spy = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting && activeId !== entry.target.id) activeId = entry.target.id;
				}
			},
			{ rootMargin: '-72px 0px -75% 0px', threshold: 0 }
		);
		heads.forEach((h) => spy.observe(h));
		return () => spy.disconnect();
	});
</script>

<svelte:head>
	<title>{data.title ?? 'Shared doc'} · ShareMD</title>
	<meta name="description" content={plainDescription} />
	<meta property="og:title" content={data.title} />
	<meta property="og:description" content={plainDescription} />
	<meta property="og:type" content="article" />
	<meta name="twitter:card" content="summary" />
	<meta name="twitter:title" content={data.title} />
	<meta name="twitter:description" content={plainDescription} />
</svelte:head>

{#if isGone}
	<!-- expired or views exhausted: no content, friendly way out -->
	<main class="mx-auto grid w-full max-w-xl flex-1 place-items-center px-4 py-16 sm:px-6">
		<div class="rise w-full border border-line bg-surface p-6 text-center sm:p-8 dark:border-night-line dark:bg-night-surface">
			<p class="font-mono text-xs tracking-widest text-ink-soft uppercase dark:text-slate-500">Link done</p>
			<h1 class="font-display mt-3 text-2xl font-bold tracking-tight">This link expired or hit its view limit.</h1>
			<p class="mt-3 text-[15px] leading-relaxed text-ink-soft dark:text-slate-400">
				Ask the sender for a fresh one, or share a doc of your own.
			</p>
			<a
				href="/"
				class="btn-accent mt-6 inline-flex items-center justify-center px-6 py-2.5 text-[15px] font-semibold transition"
			>
				Share a new doc
			</a>
		</div>
	</main>
{:else if isGated}
	<!-- password gate: no content until unlocked -->
	<main class="mx-auto grid w-full max-w-xl flex-1 place-items-center px-4 py-16 sm:px-6">
		<div class="rise w-full border border-line bg-surface p-6 sm:p-8 dark:border-night-line dark:bg-night-surface">
			<p class="font-mono text-xs tracking-widest text-ink-soft uppercase dark:text-slate-500">Protected link</p>
			<h1 class="font-display mt-3 text-2xl font-bold tracking-tight">This link is locked.</h1>
			<p class="mt-3 text-[15px] leading-relaxed text-ink-soft dark:text-slate-400">
				Type the password to open it. Ask the sender if you do not have it.
			</p>
			<form
				onsubmit={(e) => {
					e.preventDefault();
					unlock();
				}}
				class="mt-5"
			>
				<label class="block">
					<span class="mb-1.5 block text-sm font-medium">Password</span>
					<input
						type="password"
						bind:value={pwInput}
						oninput={() => {
							pwError = null;
							unlockTried = false;
							unlockPending = false;
						}}
						placeholder="Link password"
						autocomplete="off"
						class="w-full border border-line bg-paper px-3.5 py-2.5 text-[15px] placeholder:text-ink-soft/50 focus:border-iris dark:border-night-line dark:bg-night dark:placeholder:text-slate-600"
					/>
				</label>
				{#if gateError}
					<p role="alert" class="mt-2 text-sm font-medium text-red-600 dark:text-red-300">{gateError}</p>
				{/if}
				<button
					type="submit"
					disabled={pwBusy}
					class="btn-accent mt-4 inline-flex w-full items-center justify-center px-6 py-2.5 text-[15px] font-semibold transition"
				>
					{#if pwBusy}
						<span class="size-4 animate-spin border-2 border-current border-t-transparent opacity-60" aria-hidden="true"></span>
						Unlocking…
					{:else}
						Unlock
					{/if}
				</button>
			</form>
		</div>
	</main>
{:else}
<ReadingProgress target={articleEl} />

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
				class=" border border-line px-3 py-1.5 text-[13px] font-medium transition hover:border-iris hover:text-iris dark:border-night-line dark:hover:border-indigo-300 dark:hover:text-indigo-200"
			>
				Copy link
			</button>
			<a
				href={themedRawPath}
				class=" border border-line px-3 py-1.5 text-[13px] font-medium transition hover:border-iris hover:text-iris dark:border-night-line dark:hover:border-indigo-300 dark:hover:text-indigo-200"
			>
				Raw
			</a>
			<button
				onclick={download}
				class="btn-accent px-3 py-1.5 text-[13px] font-medium transition"
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
				class="font-display text-[13px] font-semibold tracking-tight hover:text-iris"
			>
				{tocOpen ? 'Hide contents' : `Contents (${toc.length})`}
			</button>
			{#if tocOpen}
				<nav aria-label="Table of contents">
					<ul class="mt-2 space-y-1">
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
			<div class="mt-10 flex items-center justify-between gap-3 border border-line bg-surface px-4 py-3 dark:border-night-line dark:bg-night-surface">
				<p class="text-[13px] text-ink-soft dark:text-slate-500">Unlisted. Anyone with the link can read.</p>
				<a href="/" class="shrink-0 text-sm font-medium text-iris hover:underline hover:underline-offset-2 dark:text-indigo-300">Share your own →</a>
			</div>
		</div>
		<TocRail items={toc} activeId={activeId} />
	</div>
		<Mermaid article={articleEl} rev={data.id} />
</main>
{/if}

<Toast message={toast} />
<TocFloating items={toc} activeId={activeId} />
<BackToTop />
