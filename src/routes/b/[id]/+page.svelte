<script lang="ts">
	import { onMount, untrack } from 'svelte';
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
	<main class="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6 sm:py-14">
		<div class="mb-6"><BackLink href="/library" label="Library" /></div>
		<p class="text-xs tracking-widest text-ink-soft uppercase dark:text-slate-500">
			Folder · {members.length}
			{members.length === 1 ? 'doc' : 'docs'}
		</p>
		<h1 class="font-display mt-2 text-3xl font-bold tracking-tight sm:text-4xl">{data.title}</h1>
		<p class="mt-2 text-sm text-ink-soft dark:text-slate-400">
			Shared {timeAgo(data.createdAt)} · {data.views}
			{data.views === 1 ? 'view' : 'views'}
		</p>

		<div class="mt-8 flex flex-col gap-3">
			{#each members as m (m.id)}
				{#if m.gone}
					<div
						class="flex items-baseline justify-between gap-4 border border-line px-4 py-3.5 opacity-55 dark:border-night-line"
					>
						<span class="text-[15px] line-through">{m.title}</span>
						<span class="shrink-0 text-xs tracking-wide text-ink-soft uppercase dark:text-slate-500">
							{m.gone === 'expired' ? 'expired' : 'view limit'}
						</span>
					</div>
				{:else}
					<a
						href={memberHref(m)}
						class="group flex items-baseline justify-between gap-4 border border-line bg-surface px-4 py-3.5 transition hover:border-iris dark:border-night-line dark:bg-night-surface"
					>
						<span class="min-w-0">
							<span class="block text-[15px] font-medium group-hover:underline">{m.title}</span>
							<!-- Only docs somebody contributed are attributed; the creator's own
							     docs belong to the share, not to a person. -->
							{#if m.contributorName}
								<span class="mt-0.5 block text-xs text-ink-soft dark:text-slate-500">
									added by {m.contributorName}
								</span>
							{/if}
						</span>
						<span class="shrink-0 text-sm tabular-nums text-ink-soft dark:text-slate-400">
							{m.readMins} min
						</span>
					</a>
				{/if}
			{/each}
		</div>

		{#if live.length === 0 && dead.length > 0}
			<p class="mt-8 text-center text-[15px] text-ink-soft dark:text-slate-400">
				Every doc in this folder has since expired or hit its view limit.
			</p>
		{/if}

		{#if data.canContribute}
			<section class="mt-8 border border-line bg-surface p-4 sm:p-5 dark:border-night-line dark:bg-night-surface">
				<button
					type="button"
					onclick={() => (addOpen = !addOpen)}
					aria-expanded={addOpen}
					aria-controls="add-doc-form"
					class="flex w-full items-baseline justify-between gap-3 text-left"
				>
					<span class="font-display text-[15px] font-semibold tracking-tight">Add your own doc</span>
					<span class="shrink-0 text-sm text-ink-soft dark:text-slate-400">
						{addOpen ? 'Hide' : 'Open'}
					</span>
				</button>
				<p class="mt-1.5 text-sm leading-relaxed text-ink-soft dark:text-slate-400">
					Your doc joins the list for everyone who opens this folder. Adding one does not let you
					edit anyone else's — yours stays yours, theirs stays theirs.
				</p>

				{#if addOpen}
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
				{/if}
			</section>
		{/if}

		<div class="mt-10 flex flex-wrap items-center justify-center gap-3 border-t border-line pt-8 dark:border-night-line">
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