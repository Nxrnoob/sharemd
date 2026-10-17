<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { copyText } from '$lib/clipboard';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import HowItWorksModal from '$lib/components/HowItWorksModal.svelte';
	import BackLink from '$lib/components/BackLink.svelte';
	import BackToTop from '$lib/components/BackToTop.svelte';
	import DocTile from '$lib/components/DocTile.svelte';
	import PaneHeader from '$lib/components/PaneHeader.svelte';
	import FileGlyph from '$lib/components/FileGlyph.svelte';
	import StatusBar from '$lib/components/StatusBar.svelte';
	import { RULE, SUBTLE } from '$lib/components/fileSkin';
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
	let pwStatus = $state('');
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
	let addTileEl = $state<HTMLElement | null>(null);
	let addTitleEl = $state<HTMLInputElement | null>(null);
	let titleTouched = $state(false);
	let textareaEl = $state<HTMLTextAreaElement | null>(null);
	let fileInputEl = $state<HTMLInputElement | null>(null);
	let dropActive = $state(false);

	const MAX_BYTES = 512 * 1024;
	const byteLength = $derived(new TextEncoder().encode(addMarkdown).length);
	const percent = $derived(Math.min(100, Math.round((byteLength / MAX_BYTES) * 100)));
	const kbLabel = $derived((byteLength / 1024).toFixed(1) + ' KB');

	const DRAFT_KEY = (id: string) => `sharemd-contrib-draft-${id}`;
	let draftTimer: ReturnType<typeof setTimeout> | null = null;

	function saveContribDraft() {
		if (typeof localStorage === 'undefined') return;
		if (draftTimer) clearTimeout(draftTimer);
		draftTimer = setTimeout(() => {
			if (!addTitle.trim() && !addMarkdown.trim()) {
				try {
					localStorage.removeItem(DRAFT_KEY(data.id));
				} catch {}
			} else {
				try {
					localStorage.setItem(
						DRAFT_KEY(data.id),
						JSON.stringify({ title: addTitle, markdown: addMarkdown })
					);
				} catch {}
			}
		}, 300);
	}

	function restoreContribDraft() {
		if (typeof localStorage === 'undefined') return;
		try {
			const saved = localStorage.getItem(DRAFT_KEY(data.id));
			if (saved) {
				const parsed = JSON.parse(saved) as { title?: unknown; markdown?: unknown };
				if (typeof parsed.markdown === 'string') addMarkdown = parsed.markdown;
				if (typeof parsed.title === 'string' && parsed.title.trim()) {
					addTitle = parsed.title;
					titleTouched = true;
				}
			}
		} catch {}
	}

	function onMarkdownInput() {
		addError = null;
		addOk = null;
		if (!titleTouched && !addTitle.trim()) {
			const match = addMarkdown.match(/^#\s+(.+)$/m);
			if (match) {
				addTitle = match[1].trim();
			}
		}
		saveContribDraft();
	}

	function onTextareaKeydown(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
			e.preventDefault();
			contribute();
			return;
		}
		if (e.key === 'Tab') {
			e.preventDefault();
			const ta = textareaEl;
			if (!ta) return;
			const start = ta.selectionStart;
			const end = ta.selectionEnd;
			if (e.shiftKey) {
				const lineStart = addMarkdown.lastIndexOf('\n', start - 1) + 1;
				if (addMarkdown.slice(lineStart, lineStart + 2) === '  ') {
					addMarkdown = addMarkdown.slice(0, lineStart) + addMarkdown.slice(lineStart + 2);
					tick().then(() => {
						ta.selectionStart = Math.max(lineStart, start - 2);
						ta.selectionEnd = Math.max(lineStart, end - 2);
					});
				}
			} else {
				addMarkdown = addMarkdown.slice(0, start) + '  ' + addMarkdown.slice(end);
				tick().then(() => {
					ta.selectionStart = ta.selectionEnd = start + 2;
				});
			}
			saveContribDraft();
		}
	}

	async function handleDroppedFile(file: File) {
		if (
			!file.name.endsWith('.md') &&
			!file.name.endsWith('.markdown') &&
			!file.name.endsWith('.txt')
		) {
			addError = 'Drop markdown (.md) or text files only.';
			return;
		}
		try {
			const text = await file.text();
			addMarkdown = text;
			const match = text.match(/^#\s+(.+)$/m);
			addTitle = match ? match[1].trim() : file.name.replace(/\.[^/.]+$/, '');
			titleTouched = true;
			saveContribDraft();
			await tick();
			textareaEl?.focus();
		} catch {
			addError = 'Could not read the dropped file.';
		}
	}

	function onDropstripDrop(e: DragEvent) {
		e.preventDefault();
		dropActive = false;
		if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
			const f = e.dataTransfer.files[0];
			if (f) handleDroppedFile(f);
		}
	}
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
		restoreContribDraft();
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
		pwStatus = 'Bribing the gatekeeper...';
		gateError = null;
		try {
			// POST body in, HttpOnly grant cookie out, the password never
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
					typeof out.error === 'string' ? out.error : 'Wrong password. The gatekeeper is unimpressed.';
				pwBusy = false;
				pwStatus = '';
				return;
			}
			pwStatus = 'Access granted! Opening folder...';
			// Re-run the load with the grant in place. Query params that belong to
			// the link itself (?theme= and friends) are preserved; a legacy ?pw=
			// is dropped rather than carried forward.
			const params = new URLSearchParams(page.url.search);
			params.delete('pw');
			const query = params.toString();
			await goto(`${page.url.pathname}${query ? `?${query}` : ''}`, { invalidateAll: true });
		} catch {
			gateError = 'Could not reach the server. Check your connection.';
			pwBusy = false;
			pwStatus = '';
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
			addTitle = '';
			titleTouched = false;
			try {
				localStorage.removeItem(DRAFT_KEY(data.id));
			} catch {}
			if (addName.trim()) saveName(addName.trim());
			addOk = `Added "${newTitle}" to this folder.`;
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
					class="btn-accent mt-4 inline-flex w-full items-center justify-center gap-2 px-6 py-2.5 text-[15px] font-semibold transition"
				>
					{#if pwBusy}
						<span class="size-4 animate-spin rounded-full border-2 border-current border-t-transparent opacity-80" aria-hidden="true"></span>
						<span>{pwStatus || 'Unlocking...'}</span>
					{:else}
						Unlock
					{/if}
				</button>
			</form>
		</div>
	</main>
{:else}
	<main class="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:px-6 sm:py-14">
		<div class="mb-6"><BackLink href="/library" label="Library" /></div>

		<PaneHeader eyebrow="Folder" title={data.title}>
			{#snippet meta()}
				Shared {timeAgo(data.createdAt)} · {data.views}
				{data.views === 1 ? 'view' : 'views'}
			{/snippet}
		</PaneHeader>

		{#if members.length === 0}
			<div class="mt-6 border border-dashed px-5 py-12 text-center {RULE}">
				<p class="text-[15px] font-medium">This folder is empty.</p>
				<p class="mt-1.5 text-sm {SUBTLE}">
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
							     order, but are never an anchor: there is no link to a page
							     that would only bounce the reader. Dashed outline and a
							     struck title say "not here" at a glance. -->
							<DocTile
								label={m.title}
								dashed
								glyphDashed
								faint
								strike
								tooltip={m.title}
							>
								{#snippet meta()}
									<span class="text-[10px] tracking-[0.12em] uppercase">
										{m.gone === 'expired' ? 'expired' : 'view limit'}
									</span>
								{/snippet}
							</DocTile>
						{:else}
							<DocTile label={m.title} href={memberHref(m)} tooltip={memberSummary(m)}>
								{#snippet meta()}
									{m.readMins} min read{#if m.contributorName}{' · '}<span class="sr-only"
										>{'added by '}</span
									>{m.contributorName}{/if}
								{/snippet}
							</DocTile>
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
						<DocTile
							as="button"
							label="Add your own doc"
							glyph="plus"
							dashed
							tooltip="Add your own doc"
							aria-expanded={addOpen}
							aria-controls="add-doc-form"
							onclick={() => (addOpen ? closeAddForm() : openAddForm())}
							bind:el={addTileEl}
						>
							{#snippet meta()}New file{/snippet}
						</DocTile>
					</li>
				{/if}
			</ul>

			<StatusBar text={statusLine} />
		{/if}

		{#if live.length === 0 && dead.length > 0}
			<p class="mt-6 text-center text-[15px] {SUBTLE}">
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
							<!-- Dropzone for files -->
							<div
								role="button"
								tabindex="0"
								onclick={() => fileInputEl?.click()}
								onkeydown={(e) => {
									if (e.key === 'Enter' || e.key === ' ') {
										e.preventDefault();
										fileInputEl?.click();
									}
								}}
								ondragover={(e) => {
									e.preventDefault();
									dropActive = true;
								}}
								ondragleave={() => (dropActive = false)}
								ondrop={onDropstripDrop}
								class="mb-4 flex cursor-pointer items-center justify-center gap-2 border border-dashed py-3 px-4 text-center text-xs transition {dropActive ? 'border-iris bg-iris/5 text-iris' : 'border-line text-ink-soft hover:border-iris hover:text-iris dark:border-night-line dark:text-slate-400'}"
							>
								<FileGlyph kind="doc" class="size-4 shrink-0" />
								<span>Drop a <code>.md</code> file here, or click to browse</span>
								<input
									type="file"
									accept=".md,.markdown,.txt,text/markdown,text/plain"
									bind:this={fileInputEl}
									class="hidden"
									onchange={(e) => {
										const target = e.currentTarget as HTMLInputElement;
										if (target.files && target.files.length > 0) {
											handleDroppedFile(target.files[0]);
										}
									}}
								/>
							</div>

							<label class="block">
								<span class="mb-1.5 block text-sm font-medium">Title</span>
								<input
									bind:this={addTitleEl}
									bind:value={addTitle}
									oninput={() => {
										titleTouched = true;
										saveContribDraft();
									}}
									maxlength="200"
									placeholder="Document title"
									class="w-full border border-line bg-paper px-3.5 py-2.5 text-[15px] placeholder:text-ink-soft/50 focus:border-iris dark:border-night-line dark:bg-night dark:placeholder:text-slate-600"
								/>
							</label>
							<label class="mt-4 block">
								<span class="mb-1.5 block text-sm font-medium">Markdown</span>
								<textarea
									bind:this={textareaEl}
									bind:value={addMarkdown}
									oninput={onMarkdownInput}
									onkeydown={onTextareaKeydown}
									rows="10"
									spellcheck="false"
									placeholder={'# Your doc\n\nWrite it in markdown.'}
									class="w-full border border-line bg-paper px-3.5 py-3 font-mono text-[13.5px] leading-relaxed placeholder:text-ink-soft/50 focus:border-iris dark:border-night-line dark:bg-night dark:placeholder:text-slate-600"
								></textarea>
							</label>

							<!-- Size meter -->
							<div class="mt-2 flex items-center justify-between text-xs text-ink-soft dark:text-slate-500">
								<span class="font-mono">{kbLabel} / 512 KB</span>
								{#if byteLength > MAX_BYTES * 0.9}
									<span class="text-amber-500 font-medium">Approaching size limit</span>
								{/if}
							</div>
							<div class="mt-1 h-1 w-full overflow-hidden bg-line dark:bg-night-line">
								<div
									class="h-full transition-all duration-150 {byteLength > MAX_BYTES ? 'bg-red-500' : 'bg-iris'}"
									style="width: {percent}%"
								></div>
							</div>

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
							<div class="mt-4 flex items-center justify-between gap-3">
								<button
									type="submit"
									disabled={addBusy || byteLength > MAX_BYTES}
									class="btn-accent inline-flex items-center justify-center px-5 py-2.5 text-[15px] font-semibold transition disabled:opacity-50"
								>
									{addBusy ? 'Adding…' : 'Add to folder'}
								</button>
								<span class="font-mono text-xs text-ink-soft dark:text-slate-500">Cmd+Enter to submit</span>
							</div>
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