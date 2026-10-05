<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import { owns, getOwnedToken, updateShelfTitle } from '$lib/shelf';
	import { page } from '$app/state';
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
	// Password gate state. Backend may return { passwordRequired: true } with
	// no content, or { gone: true } for expired/used-up links.
	let pwInput = $state('');
	let pwBusy = $state(false);
	let pwError = $state<string | null>(null);
	let unlockTried = $state(false);
	// True between submit and the refreshed load data landing. The error is
	// only ever set from the *latest* completed attempt, never the flight.
	let unlockPending = $state(false);
	let isOwner = $state(false);
	let editing = $state(false);
	let editTitle = $state('');
	let editMarkdown = $state('');
	let editBusy = $state(false);
	let editError = $state<string | null>(null);
	let scrolledPastHeader = $state(false);
	const hasMermaid = $derived(Boolean(data.html && data.html.includes('mermaid-block')));

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

	const hasArticleH1 = $derived(
		Boolean(
			data.html &&
			toc.length > 0 &&
			toc[0].level === 1 &&
			(toc[0].text.toLowerCase() === (data.title || '').trim().toLowerCase() ||
			 (data.title || '').trim().toLowerCase().startsWith(toc[0].text.toLowerCase()))
		)
	);
	const showTopBarTitle = $derived(!hasArticleH1 || scrolledPastHeader);

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

	function toDownloadFilename(title: string | null | undefined, fallback: string): string {
		const slug = (title || '')
			.toLowerCase()
			.trim()
			.replace(/[*_`~\[\]()!#]/g, '')
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 60);
		return `${slug || fallback}.md`;
	}

	async function download() {
		try {
			const res = await fetch(themedRawPath);
			if (!res.ok) throw new Error();
			const text = await res.text();
			const blob = new Blob([text], { type: 'text/markdown' });
			const a = document.createElement('a');
			a.href = URL.createObjectURL(blob);
			a.download = toDownloadFilename(data.title || data.slug, data.id);
			document.body.appendChild(a);
			a.click();
			a.remove();
			setTimeout(() => URL.revokeObjectURL(a.href), 4000);
		} catch {
			flash('Download failed. Please try again.');
		}
	}

	function startEditing() {
		if (editing) {
			editing = false;
			editError = null;
			return;
		}
		editTitle = data.title || '';
		editMarkdown = data.rawMarkdown || '';
		editError = null;
		editing = true;
	}

	async function saveEdit() {
		editError = null;
		if (!editMarkdown.trim()) {
			editError = 'Markdown cannot be empty.';
			return;
		}
		const token = getOwnedToken(data.id);
		if (!token) {
			editError = 'Owner token not found in this browser.';
			return;
		}
		editBusy = true;
		try {
			const res = await fetch(`/api/docs/${encodeURIComponent(data.id)}`, {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					title: editTitle.slice(0, 200),
					markdown: editMarkdown,
					token
				})
			});
			const result = (await res.json().catch(() => ({}))) as { error?: unknown };
			if (!res.ok) {
				editError = typeof result.error === 'string' ? result.error : 'Save failed. Try again.';
				return;
			}
			if (editTitle.trim()) {
				updateShelfTitle(data.id, editTitle.trim());
			}
			editing = false;
			await invalidateAll();
			flash('Doc updated.');
		} catch {
			editError = 'Could not reach server. Check connection.';
		} finally {
			editBusy = false;
		}
	}

	function onEditKeyDown(e: KeyboardEvent & { currentTarget: HTMLTextAreaElement }) {
		if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
			e.preventDefault();
			if (!editBusy) saveEdit();
			return;
		}
		if (e.key === 'Tab') {
			e.preventDefault();
			const ta = e.currentTarget;
			const start = ta.selectionStart;
			const end = ta.selectionEnd;
			const val = ta.value;
			if (e.shiftKey) {
				const lineStart = val.lastIndexOf('\n', start - 1) + 1;
				if (val.slice(lineStart, lineStart + 2) === '  ') {
					ta.value = val.slice(0, lineStart) + val.slice(lineStart + 2);
					ta.selectionStart = Math.max(lineStart, start - 2);
					ta.selectionEnd = Math.max(lineStart, end - 2);
					editMarkdown = ta.value;
				} else if (val[lineStart] === ' ') {
					ta.value = val.slice(0, lineStart) + val.slice(lineStart + 1);
					ta.selectionStart = Math.max(lineStart, start - 1);
					ta.selectionEnd = Math.max(lineStart, end - 1);
					editMarkdown = ta.value;
				}
			} else {
				ta.value = val.substring(0, start) + '  ' + val.substring(end);
				ta.selectionStart = ta.selectionEnd = start + 2;
				editMarkdown = ta.value;
			}
		}
	}

	async function forkDoc() {
		try {
			const draft = {
				title: data.title ? `${data.title} (fork)` : 'Untitled fork',
				markdown: data.rawMarkdown || ''
			};
			localStorage.setItem('sharemd-draft', JSON.stringify(draft));
			await goto('/');
		} catch {
			flash('Could not fork document.');
		}
	}

	async function copyMarkdown() {
		if (data.rawMarkdown && (await copyText(data.rawMarkdown))) {
			flash('Markdown copied to clipboard.');
		} else {
			flash('Copy failed. Try downloading .md instead.');
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
		isOwner = owns(data.id);
		const handleScroll = () => {
			scrolledPastHeader = window.scrollY > 90;
		};
		window.addEventListener('scroll', handleScroll, { passive: true });
		handleScroll();
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
			window.removeEventListener('scroll', handleScroll);
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
			<p class="text-xs tracking-widest text-ink-soft uppercase dark:text-slate-500">Link done</p>
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
			<p class="text-xs tracking-widest text-ink-soft uppercase dark:text-slate-500">Protected link</p>
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
			{#if showTopBarTitle}
				<h1 class="font-display truncate text-[17px] font-semibold tracking-tight transition-opacity duration-200">
					{data.title}
				</h1>
			{/if}
			<p class="font-mono text-[11px] text-ink-soft dark:text-slate-500 {showTopBarTitle ? 'mt-0.5' : ''}">
				{dateLabel} · {data.views} {data.views === 1 ? 'view' : 'views'} · {data.readTime}
			</p>
		</div>
		<div class="flex shrink-0 items-center gap-1.5 print:hidden">
			{#if isOwner}
				<button
					onclick={startEditing}
					class="border border-line px-3 py-1.5 text-[13px] font-medium transition hover:border-iris hover:text-iris dark:border-night-line"
				>
					{editing ? 'Cancel edit' : 'Edit'}
				</button>
			{:else}
				<button
					onclick={forkDoc}
					class="border border-line px-3 py-1.5 text-[13px] font-medium transition hover:border-iris hover:text-iris dark:border-night-line"
				>
					Fork
				</button>
			{/if}
			<button
				onclick={copyMarkdown}
				class="border border-line px-3 py-1.5 text-[13px] font-medium transition hover:border-iris hover:text-iris dark:border-night-line"
			>
				Copy MD
			</button>
			<button
				onclick={copyLink}
				class="border border-line px-3 py-1.5 text-[13px] font-medium transition hover:border-iris hover:text-iris dark:border-night-line"
			>
				Copy link
			</button>
			<button
				onclick={() => window.print()}
				class="border border-line px-3 py-1.5 text-[13px] font-medium transition hover:border-iris hover:text-iris dark:border-night-line"
			>
				PDF
			</button>
			<button
				onclick={download}
				class="btn-accent px-3 py-1.5 text-[13px] font-medium transition"
			>
				Download .md
			</button>
		</div>
	</div>
	{#if toc.length >= 3}
		<div class="mx-auto w-full max-w-3xl px-4 pb-3 sm:px-6 lg:hidden print:hidden">
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
									class="block truncate text-[13px] text-ink-soft hover:text-iris hover:underline hover:underline-offset-2 dark:text-slate-400"
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
			{#if editing}
				<div class="border border-line bg-surface p-4 sm:p-6 dark:border-night-line dark:bg-night-surface">
					<div class="mb-4">
						<label class="mb-1.5 block text-sm font-medium" for="edit-title">Title</label>
						<input
							id="edit-title"
							bind:value={editTitle}
							maxlength="200"
							placeholder="Document title"
							class="w-full border border-line bg-paper px-3.5 py-2.5 text-[15px] font-medium placeholder:text-ink-soft/50 focus:border-iris dark:border-night-line dark:bg-night"
						/>
					</div>
					<div class="mb-4">
						<label class="mb-1.5 flex items-baseline justify-between text-sm font-medium" for="edit-markdown">
							Markdown
							<span class="font-mono text-xs font-normal text-ink-soft dark:text-slate-500">Cmd+Enter to save</span>
						</label>
						<textarea
							id="edit-markdown"
							bind:value={editMarkdown}
							onkeydown={onEditKeyDown}
							rows="18"
							spellcheck="false"
							class="w-full border border-line bg-paper px-3.5 py-3 font-mono text-[13.5px] leading-relaxed placeholder:text-ink-soft/50 focus:border-iris dark:border-night-line dark:bg-night"
						></textarea>
					</div>
					{#if editError}
						<p class="mb-3 text-sm text-red-500">{editError}</p>
					{/if}
					<div class="flex items-center gap-2">
						<button
							type="button"
							onclick={saveEdit}
							disabled={editBusy}
							class="btn-accent px-5 py-2 text-sm font-semibold transition disabled:opacity-50"
						>
							{editBusy ? 'Saving…' : 'Save changes'}
						</button>
						<button
							type="button"
							onclick={() => (editing = false)}
							class="border border-line px-4 py-2 text-sm font-medium transition hover:border-iris hover:text-iris dark:border-night-line"
						>
							Cancel
						</button>
					</div>
				</div>
			{:else}
				<article
					bind:this={articleEl}
					use:codeCopy
					class="prose prose-share rise max-w-none sm:prose-lg dark:prose-invert"
				>
					{@html data.html}
				</article>
				<div class="mt-10 flex items-center justify-between gap-3 border border-line bg-surface px-4 py-3 dark:border-night-line dark:bg-night-surface">
					<p class="text-[13px] text-ink-soft dark:text-slate-500">Unlisted. Anyone with the link can read.</p>
					<a href="/" class="shrink-0 text-sm font-medium text-iris hover:underline hover:underline-offset-2">Share your own →</a>
				</div>
			{/if}
		</div>
		<TocRail items={toc} activeId={activeId} />
	</div>
		{#if hasMermaid}
			{#await import('$lib/components/Mermaid.svelte') then { default: Mermaid }}
				<Mermaid article={articleEl} rev={data.id} />
			{/await}
		{/if}
</main>
{/if}

<Toast message={toast} />
<TocFloating items={toc} activeId={activeId} />
<BackToTop />
