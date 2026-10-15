<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { copyText } from '$lib/clipboard';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import HowItWorksModal from '$lib/components/HowItWorksModal.svelte';
	import BackLink from '$lib/components/BackLink.svelte';
	import BackToTop from '$lib/components/BackToTop.svelte';
	import { noteViewed } from '$lib/recent';
	import { addToShelf } from '$lib/shelf';
	import {
		applySessionTheme,
		buildThemedUrl,
		getThemeFromUrl,
		isThemeId,
		DEFAULT_THEME_ID
	} from '$lib/themes';
	import type { ThemeId } from '$lib/themes';

	let { data } = $props();

	type Member = (typeof data)['members'][number];

	/** This bundle's own path, used to mark where a reader arrived from. */
	const bundleHref = $derived(`/b/${data.slug ?? data.id}`);

	// Same contract as the reader: only record what the visitor actually got to
	// see, so a locked or expired folder never pollutes their trail.
	$effect(() => {
		if (isGone || isGated) return;
		noteViewed('bundle', data.id, data.slug, data.title);
	});

	const isGone = $derived(data.gone === true);
	const isGated = $derived(!isGone && data.passwordRequired === true);

	let pwInput = $state('');
	let pwBusy = $state(false);
	let gateError = $state<string | null>(null);
	let copied = $state(false);
	// Theme actually on screen (link override, folder colourway, or viewer
	// pick). Links built below always carry this one.
	let screenTheme = $state<ThemeId>(DEFAULT_THEME_ID);

	// Contributions. The panel only exists on a password-gated folder the
	// viewer has actually unlocked (`data.canContribute`).
	let addOpen = $state(false);
	let addTitle = $state('');
	let addMarkdown = $state('');
	let addName = $state('');
	let addBusy = $state(false);
	let addError = $state<string | null>(null);
	let addOk = $state<string | null>(null);
	// The add tile lives in the file grid, so opening the form can leave it
	// above the fold on a long folder. Both ends keep focus on the tile.
	let addTileEl = $state<HTMLButtonElement | null>(null);
	let addTitleEl = $state<HTMLInputElement | null>(null);

	// Docs added from this page, shown immediately instead of via a reload:
	// the server counts one view per load, and a contributor should not spend
	// the folder's view budget on their own write.
	let added = $state<Member[]>([]);

	/** Last-used display name, so repeat contributors are not retyped each time. */
	const NAME_KEY = 'sharemd-contributor-name';
	// Filler for the optional attribution: two short word lists rather than a
	// random string, because the result is read by other humans in the folder.
	const NAME_HEADS = [
		'Amber',
		'Brave',
		'Clever',
		'Gentle',
		'Lucky',
		'Mellow',
		'Nimble',
		'Quiet',
		'Sunny',
		'Swift',
		'Teal',
		'Wandering'
	];
	const NAME_TAILS = [
		'Badger',
		'Falcon',
		'Fox',
		'Heron',
		'Ibis',
		'Lynx',
		'Marten',
		'Moth',
		'Otter',
		'Puffin',
		'Tapir',
		'Wren'
	];

	// localStorage is best-effort and client-only, same contract as the shelf:
	// every access is guarded so SSR and private mode both fall through.
	function loadName(): string | null {
		try {
			if (typeof localStorage === 'undefined') return null;
			const raw = localStorage.getItem(NAME_KEY);
			return raw && raw.trim() ? raw.trim().slice(0, 60) : null;
		} catch {
			return null;
		}
	}

	function saveName(name: string) {
		try {
			if (typeof localStorage === 'undefined') return;
			localStorage.setItem(NAME_KEY, name.slice(0, 60));
		} catch {
			/* private mode / quota: the name is a convenience, not state */
		}
	}

	const themedPath = $derived(buildThemedUrl(bundleHref, screenTheme));
	const shareUrl = $derived(
		typeof location !== 'undefined' ? new URL(themedPath, location.origin).href : themedPath
	);

	const members = $derived([...data.members, ...added]);
	const live = $derived(members.filter((m) => !m.gone));
	const dead = $derived(members.filter((m) => m.gone));
	/** Docs somebody else put here — the "who do I ask about this" signal. */
	const contributedCount = $derived(members.filter((m) => m.contributorName !== null).length);

	/**
	 * The tally, in the place a file manager keeps it: on the status bar under
	 * the contents, never in the header. The header belongs to the folder's own
	 * name alone, or the folder starts competing with what is inside it.
	 * Zero-valued clauses drop out rather than printing "0 contributors".
	 */
	const statusLine = $derived.by(() => {
		const n = members.length;
		const parts = [`${n} ${n === 1 ? 'item' : 'items'}`];
		const c = contributedCount;
		if (c > 0) parts.push(`${c} from ${c === 1 ? 'contributor' : 'contributors'}`);
		if (dead.length > 0) parts.push(`${dead.length} unavailable`);
		return parts.join('  ·  ');
	});

	/** Full sentence behind a tile, for its tooltip and its hover title. */
	function memberSummary(m: Member): string {
		const read = `${m.readMins} min read`;
		return m.contributorName ? `${read} · added by ${m.contributorName}` : read;
	}

	async function openAddForm() {
		addOpen = true;
		// The tile is the last item in the grid, so on a long folder the form
		// opens below the fold. Focusing the first field scrolls it into view.
		await tick();
		addTitleEl?.focus();
	}

	async function closeAddForm() {
		addOpen = false;
		await tick();
		addTileEl?.focus();
	}

	function timeAgo(ts: number): string {
		const s = Math.floor((Date.now() - ts) / 1000);
		if (s < 60) return 'just now';
		const m = Math.floor(s / 60);
		if (m < 60) return `${m} min ago`;
		const h = Math.floor(m / 60);
		if (h < 24) return `${h} hr ago`;
		const d = Math.floor(h / 24);
		if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`;
		return new Date(ts).toLocaleDateString();
	}

	async function copyLink() {
		if (await copyText(shareUrl)) {
			copied = true;
			setTimeout(() => (copied = false), 1600);
		}
	}

	/**
	 * Member link. `from` marks where the reader arrived from, so it stays on
	 * the plain folder path (the reader validates that param strictly) and the
	 * active theme rides along as its own param, so a themed folder visit
	 * carries that colourway into the doc instead of snapping back.
	 */
	function memberHref(m: Member): string {
		return buildThemedUrl(`${m.href}?from=${encodeURIComponent(bundleHref)}`, screenTheme);
	}

	async function unlock() {
		if (!pwInput) {
			gateError = 'Enter the password.';
			return;
		}
		pwBusy = true;
		gateError = null;
		try {
			// POST body in, HttpOnly grant cookie out — the password never
			// reaches the URL, unlike the `?pw=` this used to build.
			const res = await fetch(`/api/bundles/${data.id}/unlock`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ password: pwInput })
			});
			pwInput = '';
			if (!res.ok) {
				const out = (await res.json().catch(() => ({}))) as { error?: unknown };
				gateError =
					typeof out.error === 'string' ? out.error : 'Wrong password. Try again.';
				return;
			}
			// Re-run the load with the grant in place. Query params that belong to
			// the link itself (?theme= and friends) are preserved; a legacy ?pw=
			// is dropped rather than carried forward.
			const params = new URLSearchParams(page.url.search);
			params.delete('pw');
			const query = params.toString();
			await goto(`${page.url.pathname}${query ? `?${query}` : ''}`, { invalidateAll: true });
		} catch {
			gateError = 'Could not reach the server. Check your connection.';
		} finally {
			pwBusy = false;
		}
	}

	onMount(() => {
		addName = loadName() ?? '';

		// Follow later viewer picks (ThemePicker) so the links built here match
		// what is on screen. Compare-then-bail: setAttribute fires the observer
		// even when the value is unchanged, and that must never churn
		// screenTheme (which feeds the share URL) on its own.
		const themeObs = new MutationObserver(() => {
			const ds = document.documentElement.dataset.theme;
			if (isThemeId(ds) && screenTheme !== ds) screenTheme = ds;
		});
		themeObs.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ['data-theme']
		});
		return () => themeObs.disconnect();
	});

	// The paint is a $effect.pre rather than onMount for two reasons. It has to
	// re-run for the second folder — client navigations reuse this component
	// instance, and app.html's inline script only runs on a cold load — and
	// pre-effects flush before the layout's ThemePicker onMount reads
	// data-theme, so the control in the header never ends up labelling the old
	// theme while this folder is painted in the creator's.
	// A ?theme= link param still wins; otherwise the folder's own colourway
	// applies for the session only, never over the viewer's stored default.
	// Reads of screenTheme are untracked, so the deps stay (data.id, data.theme,
	// page.url.search) and the effect settles.
	$effect.pre(() => {
		void data.id;
		const own = data.theme;
		const override = getThemeFromUrl(page.url.search);
		if (override) {
			if (document.documentElement.dataset.theme !== override) applySessionTheme(override);
			if (untrack(() => screenTheme) !== override) screenTheme = override;
			return;
		}
		if (isThemeId(own)) {
			if (document.documentElement.dataset.theme !== own) applySessionTheme(own);
			if (untrack(() => screenTheme) !== own) screenTheme = own;
			return;
		}
		// No folder colourway to honour: whatever is painted (usually the
		// viewer's own pick) stays.
		const ds = document.documentElement.dataset.theme;
		if (isThemeId(ds) && untrack(() => screenTheme) !== ds) screenTheme = ds;
	});

	// Same reused-instance hazard for the contribution form: a half-written doc
	// belongs to the folder it was typed for and must never appear in the next
	// one. Deps are data.id alone — the reads are untracked, so the reset
	// cannot retrigger itself.
	$effect(() => {
		void data.id;
		if (untrack(() => added.length) > 0) added = [];
		if (untrack(() => addMarkdown) !== '' || untrack(() => addOpen)) {
			addMarkdown = '';
			addTitle = '';
			addError = null;
			addOk = null;
			addOpen = false;
		}
	});

	/** Mirrors the server's own reading-time estimate for a member row. */
	function estimateReadMins(md: string): number {
		const words = md.trim().split(/\s+/).filter(Boolean).length;
		return Math.max(1, Math.ceil(words / 200));
	}

	function rollName() {
		const head = NAME_HEADS[Math.floor(Math.random() * NAME_HEADS.length)] ?? '';
		const tail = NAME_TAILS[Math.floor(Math.random() * NAME_TAILS.length)] ?? '';
		addName = `${head} ${tail}`.trim();
	}

	async function contribute() {
		if (addBusy) return;
		addError = null;
		addOk = null;
		const title = addTitle.trim();
		if (!title) {
			addError = 'Give your doc a title.';
			return;
		}
		if (!addMarkdown.trim()) {
			addError = 'Markdown cannot be empty.';
			return;
		}
		addBusy = true;
		try {
			// No password in the body or the URL: the server authorises this
			// with the HttpOnly grant cookie the unlock endpoint set.
			const res = await fetch(`/api/bundles/${encodeURIComponent(data.id)}/contribute`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					title,
					markdown: addMarkdown,
					contributor: addName.trim() || undefined
				})
			});
const out = (await res.json().catch(() => ({}))) as {
			id?: unknown;
			title?: unknown;
			deleteToken?: unknown;
			error?: unknown;
		};
		if (!res.ok) {
			addError =
				typeof out.error === 'string' ? out.error : 'Could not add your doc. Try again.';
			return;
		}
		const newId = typeof out.id === 'string' ? out.id : '';
		const newTitle = typeof out.title === 'string' && out.title ? out.title : title;
		// Keep the contributor's own copy of what they just made. The server hands
		// back a delete token for this doc alone, and it is shown exactly once —
		// without storing it, they would have no way to ever remove their own
		// contribution. It authorises nothing beyond their own file.
		const newToken = typeof out.deleteToken === 'string' && out.deleteToken ? out.deleteToken : '';
		if (newId && newToken) {
			try {
				addToShelf({
					id: newId,
					slug: null,
					title: newTitle.slice(0, 200),
					token: newToken,
					createdAt: Date.now(),
					url: `/s/${newId}`,
					folder: null
				});
			} catch {
				/* shelf is best-effort; the contribution itself already landed */
			}
		}
		added = [
				...added,
				{
					id: newId,
					title: newTitle,
					slug: null,
					href: `/s/${newId}`,
					createdAt: Date.now(),
					readMins: estimateReadMins(addMarkdown),
					contributorName: addName.trim() || null,
					gone: null
				}
			];
			addMarkdown = '';
			if (addName.trim()) saveName(addName.trim());
			addOk = `Added “${newTitle}” to this folder.`;
		} catch {
			addError = 'Could not reach the server. Check your connection.';
		} finally {
			addBusy = false;
		}
	}
</script>

<svelte:head>
	<title>{data.title} · ShareMD</title>
	<meta name="description" content="A folder of {members.length} shared docs." />
	<meta property="og:title" content={data.title} />
	<meta property="og:description" content="A folder of {members.length} shared docs." />
</svelte:head>

{#if isGone}
	<main class="mx-auto grid w-full max-w-xl flex-1 place-items-center px-4 py-16 sm:px-6">
		<div class="rise w-full border border-line bg-surface p-6 text-center sm:p-8 dark:border-night-line dark:bg-night-surface">
			<p class="text-xs tracking-widest text-ink-soft uppercase dark:text-slate-500">Link done</p>
			<h1 class="font-display mt-3 text-2xl font-bold tracking-tight">
				This folder link expired or hit its view limit.
			</h1>
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
	<main class="mx-auto grid w-full max-w-xl flex-1 place-items-center px-4 py-16 sm:px-6">
		<div class="rise w-full border border-line bg-surface p-6 sm:p-8 dark:border-night-line dark:bg-night-surface">
			<p class="text-xs tracking-widest text-ink-soft uppercase dark:text-slate-500">Protected folder</p>
			<h1 class="font-display mt-3 text-2xl font-bold tracking-tight">This folder is locked.</h1>
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
						oninput={() => (gateError = null)}
						placeholder="Folder password"
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
					Unlock
				</button>
			</form>
		</div>
	</main>
{:else}
	<!-- The one document glyph for the whole folder. Every member is markdown,
	     so varied icons would be fiction; a single page-with-a-folded-corner,
	     hairline-stroked and inheriting colour, carries the type instead. -->
	{#snippet docGlyph(cls: string)}
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.5"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
			class={cls}
		>
			<path d="M14 2.5H7A1.5 1.5 0 0 0 5.5 4v16A1.5 1.5 0 0 0 7 21.5h10a1.5 1.5 0 0 0 1.5-1.5V7z"
			></path>
			<path d="M14 2.5V7h4.5"></path>
			<path d="M8.75 12.5h6.5M8.75 16h4.5"></path>
		</svg>
	{/snippet}

	<main class="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:px-6 sm:py-14">
		<div class="mb-6"><BackLink href="/library" label="Library" /></div>

		<!-- Folder header. Deliberately unboxed and set apart by a single rule:
		     the contents below are boxes, and a boxed header would sit at the
		     same weight as its own members. -->
		<header class="flex items-start gap-4 border-b border-line pb-6 dark:border-night-line">
			<svg
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="1.5"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
				class="mt-1.5 size-8 shrink-0 text-ink-soft dark:text-slate-500"
			>
				<path
					d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"
				></path>
			</svg>
			<div class="min-w-0 flex-1">
				<p class="text-xs tracking-widest text-ink-soft uppercase dark:text-slate-500">Folder</p>
				<h1 class="font-display mt-2 text-3xl font-bold tracking-tight break-words sm:text-4xl">
					{data.title}
				</h1>
				<p class="mt-2 text-sm text-ink-soft dark:text-slate-400">
					Shared {timeAgo(data.createdAt)} · {data.views}
					{data.views === 1 ? 'view' : 'views'}
				</p>
			</div>
		</header>

		{#if members.length === 0}
			<div
				class="mt-6 border border-dashed border-line px-5 py-12 text-center dark:border-night-line"
			>
				<p class="text-[15px] font-medium">This folder is empty.</p>
				<p class="mt-1.5 text-sm text-ink-soft dark:text-slate-400">
					{data.canContribute
						? 'Be the first to put a doc in it.'
						: 'Nobody has put a doc in it yet.'}
				</p>
			</div>
		{:else}
			<!-- The file grid. auto-fill reflows instead of overflowing: two tiles
			     across on a phone, three from 640px, five on a wide desktop.
			     min() on the floor means it can never demand more than the row. -->
			<ul
				class="mt-6 grid grid-cols-[repeat(auto-fill,minmax(min(148px,100%),1fr))] gap-3 sm:grid-cols-[repeat(auto-fill,minmax(176px,1fr))] sm:gap-4"
			>
				{#each members as m, i (m.id)}
					<li class="rise min-w-0" style="animation-delay: {60 + Math.min(i * 26, 420)}ms">
						{#if m.gone}
							<!-- Unavailable members stay visible and stay in the creator's
							     order, but are a div, never an anchor: there is no link
							     to a page that would only bounce the reader. Dashed
							     outline and a struck title say "not here" at a glance. -->
							<div
								class="flex h-full flex-col items-center border border-dashed border-line px-3 py-4 text-center opacity-70 sm:px-4 sm:py-5 dark:border-night-line"
							>
								{@render docGlyph(
									'size-7 shrink-0 text-ink-soft [stroke-dasharray:3_2.5] sm:size-8'
								)}
								<span
									class="mt-2.5 line-clamp-2 min-h-9 w-full text-[13.5px] leading-snug font-medium text-ink-soft line-through decoration-1 dark:text-slate-500"
									title={m.title}
								>
									{m.title}
								</span>
								<span
									class="mt-auto block w-full truncate pt-1.5 text-center font-mono text-[10px] tracking-[0.12em] text-ink-soft uppercase dark:text-slate-500"
								>
									{m.gone === 'expired' ? 'expired' : 'view limit'}
								</span>
							</div>
						{:else}
							<a
								href={memberHref(m)}
								title={memberSummary(m)}
								class="group flex h-full flex-col items-center border border-line bg-surface px-3 py-4 text-center transition hover:border-iris dark:border-night-line dark:bg-night-surface sm:px-4 sm:py-5"
							>
								{@render docGlyph(
									'size-7 shrink-0 text-ink-soft transition-colors group-hover:text-iris dark:text-slate-500 sm:size-8'
								)}
								<!-- min-h-9 holds two lines so one-line titles do not
								     unbalance their row against longer neighbours. -->
								<span
									class="mt-2.5 line-clamp-2 min-h-9 w-full text-[13.5px] leading-snug font-medium underline-offset-2 group-hover:underline"
								>
									{m.title}
								</span>
								<!-- The meta line doubles as the file manager's "size":
								     how long it takes, and who put it here. Only docs
								     somebody contributed are attributed; the creator's
								     own belong to the share, not to a person. -->
								<span
									class="mt-auto block w-full min-w-0 truncate pt-1.5 font-mono text-[11px] text-ink-soft dark:text-slate-500"
								>
									{m.readMins} min read{#if m.contributorName}{' · '}<span class="sr-only"
										>{'added by '}</span
									>{m.contributorName}{/if}
								</span>
							</a>
						{/if}
					</li>
				{/each}

				<!-- Adding is a primary action in a file manager, so it is an entry
				     in the grid rather than a panel bolted underneath it. Placed
				     last, which also keeps the keyboard order tiles → form. -->
				{#if data.canContribute}
					<li
						class="rise min-w-0"
						style="animation-delay: {60 + Math.min(members.length * 26, 420)}ms"
					>
						<button
							bind:this={addTileEl}
							type="button"
							onclick={() => (addOpen ? closeAddForm() : openAddForm())}
							aria-expanded={addOpen}
							aria-controls="add-doc-form"
							class="group flex h-full w-full flex-col items-center border border-dashed border-line px-3 py-4 text-center transition hover:border-iris hover:text-iris sm:px-4 sm:py-5 dark:border-night-line"
						>
							<!-- The plus is drawn smaller than the document glyph, which would otherwise
							     leave this tile a few pixels shorter wherever it sits alone on a
							     row. A fixed icon slot keeps every tile's rhythm identical. -->
							<span class="flex h-7 shrink-0 items-center justify-center sm:h-8">
								<svg
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="1.5"
									stroke-linecap="round"
									aria-hidden="true"
									class="size-6 shrink-0 text-ink-soft transition-colors group-hover:text-iris dark:text-slate-500 sm:size-7"
								>
									<path d="M12 5v14M5 12h14"></path>
								</svg>
							</span>
							<span
								class="mt-2.5 line-clamp-2 min-h-9 text-[13.5px] leading-snug font-semibold tracking-tight"
							>
								Add your own doc
							</span>
							<!-- Short enough to stay on one line at the narrowest tile, so
							     this row's height matches the meta row on the doc tiles. -->
							<span
								class="mt-auto block w-full min-w-0 truncate pt-1.5 text-center font-mono text-[11px] text-ink-soft dark:text-slate-500"
							>
								New file
							</span>
						</button>
					</li>
				{/if}
			</ul>

			<!-- Status bar: the window's tally line, kept under the contents. -->
			<p
				class="mt-6 border-t border-line pt-2.5 font-mono text-[11px] tracking-wide text-ink-soft dark:border-night-line dark:text-slate-500"
			>
				{statusLine}
			</p>
		{/if}

		{#if live.length === 0 && dead.length > 0}
			<p class="mt-6 text-center text-[15px] text-ink-soft dark:text-slate-400">
				Every doc in this folder has since expired or hit its view limit.
			</p>
		{/if}

		{#if data.canContribute}
			<!-- The compose panel the add tile reveals. It sits directly under the
			     grid so the tile → fields reading order is also the visual one. -->
			{#if addOpen}
				<section
					class="rise mt-6 border border-line bg-surface dark:border-night-line dark:bg-night-surface"
				>
					<div
						class="flex items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5 dark:border-night-line"
					>
						<h2 class="font-display text-[15px] font-semibold tracking-tight">Add your own doc</h2>
						<button
							type="button"
							onclick={closeAddForm}
							class="shrink-0 text-sm font-medium text-ink-soft transition hover:text-iris dark:text-slate-400"
						>
							Cancel
						</button>
					</div>
					<div class="p-4 sm:p-5">
						<p class="text-sm leading-relaxed text-ink-soft dark:text-slate-400">
							Your doc joins the list for everyone who opens this folder. Adding one does not let
							you edit anyone else's — yours stays yours, theirs stays theirs.
						</p>

						<form
							id="add-doc-form"
							onsubmit={(e) => {
								e.preventDefault();
								contribute();
							}}
							class="mt-4"
						>
							<label class="block">
								<span class="mb-1.5 block text-sm font-medium">Title</span>
								<input
									bind:this={addTitleEl}
									bind:value={addTitle}
									maxlength="200"
									placeholder="Document title"
									class="w-full border border-line bg-paper px-3.5 py-2.5 text-[15px] placeholder:text-ink-soft/50 focus:border-iris dark:border-night-line dark:bg-night dark:placeholder:text-slate-600"
								/>
							</label>
							<label class="mt-4 block">
								<span class="mb-1.5 block text-sm font-medium">Markdown</span>
								<textarea
									bind:value={addMarkdown}
									oninput={() => {
										addError = null;
										addOk = null;
									}}
									rows="10"
									spellcheck="false"
									placeholder={'# Your doc\n\nWrite it in markdown.'}
									class="w-full border border-line bg-paper px-3.5 py-3 font-mono text-[13.5px] leading-relaxed placeholder:text-ink-soft/50 focus:border-iris dark:border-night-line dark:bg-night dark:placeholder:text-slate-600"
								></textarea>
							</label>
							<div class="mt-4">
								<!-- Label is bound by id rather than wrapping: a button inside a
								     <label> would also activate the label's control on click. -->
								<label class="mb-1.5 block text-sm font-medium" for="add-name">
									Your name
									<span class="font-normal text-ink-soft dark:text-slate-500">(optional)</span>
								</label>
								<div class="flex gap-2">
									<input
										id="add-name"
										bind:value={addName}
										maxlength="60"
										placeholder="Shown next to your doc"
										class="w-full border border-line bg-paper px-3.5 py-2.5 text-[15px] placeholder:text-ink-soft/50 focus:border-iris dark:border-night-line dark:bg-night dark:placeholder:text-slate-600"
									/>
									<button
										type="button"
										onclick={rollName}
										title="Fill in a random name"
										class="shrink-0 border border-line px-3.5 py-2.5 text-[15px] font-medium transition hover:border-iris hover:text-iris dark:border-night-line"
									>
										Random
									</button>
								</div>
							</div>
							{#if addError}
								<p role="alert" class="mt-3 text-sm font-medium text-red-600 dark:text-red-300">
									{addError}
								</p>
							{/if}
							{#if addOk}
								<p
									role="status"
									class="mt-3 border border-line bg-paper px-3 py-2.5 text-sm dark:border-night-line dark:bg-night/40"
								>
									{addOk}
								</p>
							{/if}
							<button
								type="submit"
								disabled={addBusy}
								class="btn-accent mt-4 inline-flex items-center justify-center px-5 py-2.5 text-[15px] font-semibold transition disabled:opacity-50"
							>
{addBusy ? 'Adding…' : 'Add to folder'}
							</button>
						</form>
					</div>
				</section>
			{/if}
		{/if}

		<div
			class="mt-10 flex flex-wrap items-center justify-center gap-3 border-t border-line pt-8 dark:border-night-line"
		>
			<button
				type="button"
				onclick={copyLink}
				class="btn-accent inline-flex items-center justify-center px-5 py-2.5 text-[15px] font-semibold transition"
			>
				{copied ? 'Copied' : 'Copy folder link'}
			</button>
			<a
				href="/"
				class="inline-flex items-center justify-center border border-line px-5 py-2.5 text-[15px] font-medium transition hover:border-iris dark:border-night-line"
			>
				Share your own
			</a>
		</div>
	</main>
{/if}

<HowItWorksModal />
<BackToTop />