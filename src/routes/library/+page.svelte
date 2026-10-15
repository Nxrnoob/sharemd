<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import Toast from '$lib/components/Toast.svelte';
	import DeleteDocButton from '$lib/components/DeleteDocButton.svelte';
	import {
		getShelf,
		getFolders,
		createFolder,
		renameFolder,
		deleteFolder,
		setDocFolder,
		updateDocLinkSettings,
		updateShelfSlug,
		type ShelfEntry,
		type Folder
	} from '$lib/shelf';
	import type { DeleteResult } from '$lib/shelf';
	import {
		createBundleForFolder,
	getBundles,
	removeBundle,
	listContributions,
	removeContribution,
	type BundleEntry,
	type Contribution
} from '$lib/bundles';
	import { themes } from '$lib/themes';
	import { copyText } from '$lib/clipboard';

	// Library: docs shared from this browser (the silent-token shelf).
	// Client-only list, no server load, no per-row fetch. Viewers never
	// see delete UI anywhere; only shelf owners do, here and on landing.
	//
	// Folders are local metadata over that shelf — there is no server-side
	// owner to hang them off. Single-level by design; see src/lib/shelf.ts.

	type Filter = { kind: 'all' } | { kind: 'none' } | { kind: 'folder'; id: string };

	let entries = $state<ShelfEntry[]>([]);
	let folders = $state<Folder[]>([]);
	/** Folder links shared from this browser, so they can be copied again later. */
	let bundles = $state<BundleEntry[]>([]);
	let filter = $state<Filter>({ kind: 'all' });
	let toast = $state<{ message: string; kind: 'ok' | 'error' } | null>(null);
	let toastTimer: ReturnType<typeof setTimeout> | null = null;
	/** Id of the row whose copy button last succeeded, for the 1600ms "Copied". */
	let copiedId = $state<string | null>(null);
	let copiedTimer: ReturnType<typeof setTimeout> | null = null;

	let creating = $state(false);
	let newName = $state('');
	let renamingId = $state<string | null>(null);
	let renameDraft = $state('');

	let dragId = $state<string | null>(null);
	/** folder id currently being shared as one link, or null = idle */
	let sharingFolderId = $state<string | null>(null);
	/** folder id, '__none__' for the uncategorised drop target, null = idle */
	let dropTarget = $state<string | null>(null);

	// Folder link options. The same gates a doc link can carry, so a shared
	// folder can be locked with a password and bounded like any other share.
	let optionsFolder = $state<Folder | null>(null);
	let optPassword = $state('');
	let optExpiry = $state('0');
	let optMaxViews: string | number | null = $state('');
	/** Number inputs bind null when emptied, so normalise before touching .trim(). */
	function str(v: unknown): string {
		return typeof v === 'string' ? v : v == null ? '' : String(v);
	}
	let optSlug = $state('');
	/** Creator's colourway for the folder page. Empty means "no preference" —
	 *  the server stores null and the folder falls back to the reader's own theme. */
	let optTheme = $state('');
	let optError = $state<string | null>(null);

	const SLUG_RE = /^[a-z0-9-]{3,32}$/;
	const slugClean = $derived(optSlug.trim());
	const slugOk = $derived(slugClean === '' || SLUG_RE.test(slugClean));
	const optPasswordError = $derived(
		optPassword.trim() !== '' && optPassword.trim().length < 4 ? 'Min 4 characters.' : null
	);
	const optMaxViewsStr = $derived(str(optMaxViews).trim());
	const optMaxViewsValue = $derived(
		optMaxViewsStr === '' ? null : Number.parseInt(optMaxViewsStr, 10)
	);
	const optMaxViewsError = $derived(
		optMaxViewsStr !== '' &&
			(!Number.isInteger(optMaxViewsValue) || (optMaxViewsValue ?? 0) < 1)
			? 'Must be 1 or more.'
			: null
	);

	function openFolderOptions(f: Folder) {
		optionsFolder = f;
		optPassword = '';
		optExpiry = '0';
		optMaxViews = '';
		optSlug = '';
		optTheme = '';
		optError = null;
	}

	function closeFolderOptions() {
		if (sharingFolderId) return;
		optionsFolder = null;
		optError = null;
	}

	// Editable link settings for a doc that is already shared. The shelf stores no
	// gate information, so the dialog never claims to show current values — every
	// control is explicitly "leave alone" or "change this", and removing a gate is
	// its own control rather than an empty box.
	let settingsEntry = $state<ShelfEntry | null>(null);
	let sSlug = $state('');
	let sPassword = $state('');
	let sRemovePassword = $state(false);
	let sExpiry = $state('keep');
	let sMaxViews: string | number | null = $state('');
	let sNoLimit = $state(false);
	let sError = $state<string | null>(null);
	let sBusy = $state(false);

	const sSlugOk = $derived(sSlug === '' || SLUG_RE.test(sSlug));
	const sPasswordError = $derived(
		!sRemovePassword && sPassword.trim() !== '' && sPassword.trim().length < 4
			? 'Min 4 characters.'
			: null
	);
	const sMaxViewsStr = $derived(str(sMaxViews).trim());
	const sMaxViewsError = $derived(
		!sNoLimit &&
			sMaxViewsStr !== '' &&
			(!Number.isInteger(Number.parseInt(sMaxViewsStr, 10)) ||
				Number.parseInt(sMaxViewsStr, 10) < 1)
			? 'Must be 1 or more.'
			: null
	);

	function openDocSettings(entry: ShelfEntry) {
		settingsEntry = entry;
		sSlug = entry.slug ?? '';
		sPassword = '';
		sRemovePassword = false;
		sExpiry = 'keep';
		sMaxViews = '';
		sNoLimit = false;
		sError = null;
	}

	function closeDocSettings() {
		if (sBusy) return;
		settingsEntry = null;
		sError = null;
	}

	async function saveDocSettings() {
		const entry = settingsEntry;
		if (!entry || sBusy) return;
		if (!sSlugOk || sPasswordError || sMaxViewsError) {
			sError = 'Fix the highlighted field.';
			return;
		}

		// Only send keys the user actually chose to change, so an untouched field
		// cannot silently wipe a gate that is already set.
		const patch: Parameters<typeof updateDocLinkSettings>[2] = {};
		if (sSlug !== (entry.slug ?? '')) patch.slug = sSlug || null;
		if (sRemovePassword) patch.password = '';
		else if (sPassword.trim()) patch.password = sPassword.trim();
		if (sExpiry === '0') patch.expiresInSec = null;
		else if (sExpiry !== 'keep') patch.expiresInSec = Number.parseInt(sExpiry, 10);
		if (sNoLimit) patch.maxViews = null;
		else if (sMaxViewsStr !== '') patch.maxViews = Number.parseInt(sMaxViewsStr, 10);

		if (Object.keys(patch).length === 0) {
			settingsEntry = null;
			return;
		}

		sBusy = true;
		sError = null;
		try {
			const res = await updateDocLinkSettings(entry.id, entry.token, patch);
			if (!res.ok) {
				sError = res.error;
				return;
			}
			// The slug is baked into the shelf entry, and into links already sent
			// out, so keep local state in step with what the server now serves.
			// Persisting both halves matters: state alone loses the edit on
			// reload, and every re-copied link would go back to the old path.
			if (patch.slug !== undefined) {
				const next = updateShelfSlug(entry.id, res.slug);
				entries = entries.map((e) => (e.id === entry.id && next ? next : e));
			}
			settingsEntry = null;
			showToast('Link settings updated.', 'ok');
		} finally {
			sBusy = false;
		}
	}

	onMount(() => {
		entries = getShelf();
		folders = getFolders();
		bundles = getBundles();
		// Deep link from the reader's "Filed in" chip: /library?folder=<id>.
		// Unknown ids fall through to All; the stale-folder $effect also guards.
		const wanted = page.url.searchParams.get('folder');
		if (wanted && folders.some((f) => f.id === wanted)) filter = { kind: 'folder', id: wanted };
	});

	const counts = $derived.by(() => {
		const byFolder = new Map<string, number>();
		let none = 0;
		for (const e of entries) {
			if (e.folder) byFolder.set(e.folder, (byFolder.get(e.folder) ?? 0) + 1);
			else none++;
		}
		return { byFolder, none };
	});

	const visible = $derived.by(() => {
		const f = filter;
		if (f.kind === 'all') return entries;
		if (f.kind === 'none') return entries.filter((e) => !e.folder);
		return entries.filter((e) => e.folder === f.id);
	});

	// A folder can be deleted while selected; never strand the view on nothing.
	$effect(() => {
		const f = filter;
		if (f.kind === 'folder' && !folders.some((x) => x.id === f.id)) {
			filter = { kind: 'all' };
		}
	});

	function refresh() {
		entries = getShelf();
		folders = getFolders();
		bundles = getBundles();
	}

	function showToast(message: string, kind: 'ok' | 'error' = 'ok') {
		if (toastTimer) clearTimeout(toastTimer);
		toast = { message, kind };
		toastTimer = setTimeout(() => (toast = null), 4500);
	}

	function onDeleted(id: string) {
		entries = entries.filter((e) => e.id !== id);
		showToast('Doc deleted.');
	}

	function onDeleteFailed(reason: Exclude<DeleteResult, 'deleted'>) {
		showToast(reason === 'missing' ? 'That doc is already gone.' : 'Delete failed. Try again.', 'error');
	}

	/**
	 * The link as it was shared. The stored `url` wins so a re-copy hands back
	 * the exact path the server minted; entries written before links were kept
	 * fall back to deriving it, which is what the reader resolves anyway.
	 */
	function docPath(e: ShelfEntry): string {
		return e.url ?? `/s/${e.slug ?? e.id}`;
	}

	function bundlePath(b: BundleEntry): string {
		return b.url ?? `/b/${b.slug ?? b.id}`;
	}

	async function copyShareLink(path: string, rowId: string) {
		if (await copyText(new URL(path, location.origin).href)) {
			showToast('Link copied.', 'ok');
			if (copiedTimer) clearTimeout(copiedTimer);
			copiedId = rowId;
			copiedTimer = setTimeout(() => (copiedId = null), 1600);
		} else {
			showToast('Could not copy the link.', 'error');
		}
	}

	function copyDoc(e: ShelfEntry) {
		copyShareLink(docPath(e), `doc:${e.id}`);
	}

	function copyBundle(b: BundleEntry) {
		copyShareLink(bundlePath(b), `bundle:${b.id}`);
	}

	/**
	 * A bundle stores the docs it froze, not the folder it came from, so the
	 * folder is recovered by intersecting those ids with the live shelf. A
	 * bundle whose folder is gone (or whose docs all moved out) would otherwise
	 * have nowhere to live, so it lands in the uncategorised group rather than
	 * disappearing.
	 */
	type BundleGroup = { folder: Folder | null; items: BundleEntry[] };

	const bundleGroups = $derived.by((): BundleGroup[] => {
		const docFolder = new Map<string, string>();
		for (const e of entries) if (e.folder) docFolder.set(e.id, e.folder);
		const known = new Set(folders.map((f) => f.id));

		const grouped = new Map<string, BundleEntry[]>();
		const orphans: BundleEntry[] = [];
		for (const b of bundles) {
			const owner = b.docIds.map((d) => docFolder.get(d)).find((f) => f && known.has(f));
			if (owner) grouped.set(owner, [...(grouped.get(owner) ?? []), b]);
			else orphans.push(b);
		}

		const groups: BundleGroup[] = folders
			.filter((f) => grouped.has(f.id))
			.map((f) => ({ folder: f, items: grouped.get(f.id) ?? [] }));
		if (orphans.length) groups.push({ folder: null, items: orphans });
		return groups;
	});

	/** Newest bundle for a folder — `getBundles` is newest first. */
	function latestBundle(folderId: string): BundleEntry | null {
		return bundleGroups.find((g) => g.folder?.id === folderId)?.items[0] ?? null;
	}

	/**
	 * Local-only forget. The bundle keeps serving for anyone already holding
	 * the link; only `deleteBundleRemote` would take it down for everyone, so
	 * this deliberately does not reach the server.
	 */
	function forgetBundle(b: BundleEntry) {
		removeBundle(b.id);
		refresh();
		showToast(`Forgot "${b.title}". The link still works for anyone who has it.`);
	}

	/* ------------------------------------------------- contributed docs */

	// Owner-side view of docs other people added to a folder link. Only ever
	// reachable with the bundle's own token, so a reader cannot enumerate them.
	let contribBundle = $state<BundleEntry | null>(null);
	let contributions = $state<Contribution[]>([]);
	let contribLoading = $state(false);
	let contribError = $state<string | null>(null);
	let removingDocId = $state<string | null>(null);

	async function openContributions(b: BundleEntry) {
		contribBundle = b;
		contributions = [];
		contribError = null;
		contribLoading = true;
		const res = await listContributions(b.id, b.token);
		contribLoading = false;
		if (res.ok) contributions = res.value;
		else contribError = res.error;
	}

	function closeContributions() {
		if (removingDocId) return;
		contribBundle = null;
		contribError = null;
	}

	async function removeContributedDoc(c: Contribution) {
		const b = contribBundle;
		if (!b || removingDocId) return;
		removingDocId = c.docId;
		contribError = null;
		const res = await removeContribution(b.id, c.docId, b.token);
		removingDocId = null;
		if (!res.ok) {
			contribError = res.error;
			return;
		}
		contributions = contributions.filter((x) => x.docId !== c.docId);
		showToast(`Removed "${c.title}".`);
	}

	function timeAgo(ts: number): string {
		const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
		if (s < 60) return `${s}s ago`;
		const m = Math.floor(s / 60);
		if (m < 60) return `${m}m ago`;
		const h = Math.floor(m / 60);
		if (h < 24) return `${h}h ago`;
		const d = Math.floor(h / 24);
		return d === 1 ? 'yesterday' : `${d}d ago`;
	}

	/* ------------------------------------------------------------ folders */

	function submitNewFolder() {
		const name = newName.trim();
		if (!name) {
			creating = false;
			return;
		}
		const f = createFolder(name);
		if (!f) {
			showToast('Folder name is blank, taken, or you hit 50 folders.', 'error');
			return;
		}
		newName = '';
		creating = false;
		refresh();
	}

	function startRename(f: Folder) {
		renamingId = f.id;
		renameDraft = f.name;
	}

	function commitRename() {
		if (!renamingId) return;
		const ok = renameFolder(renamingId, renameDraft);
		if (!ok) showToast('Rename failed — name is blank or already taken.', 'error');
		renamingId = null;
		refresh();
	}

	function removeFolder(f: Folder) {
		deleteFolder(f.id);
		refresh();
		showToast(`"${f.name}" deleted — its docs moved to Uncategorised.`);
	}

	/**
	 * Share a whole folder as one link. The bundle is an immutable snapshot:
	 * every filed doc must be provable with a token this browser holds, and the
	 * server refuses any member that already carries its own password, expiry,
	 * or view cap — one gate governs the whole share.
	 */
	async function shareFolder(f: Folder) {
		if (sharingFolderId) return;
		if (optPasswordError || optMaxViewsError || !slugOk) {
			optError = 'Fix the highlighted field.';
			return;
		}
		optionsFolder = f;
		sharingFolderId = f.id;
		optError = null;
		try {
			const res = await createBundleForFolder(f.id, f.name, {
				password: optPassword.trim() || undefined,
				expiresInSec: optExpiry === '0' ? null : Number.parseInt(optExpiry, 10),
				maxViews: optMaxViewsValue,
				slug: slugClean || null,
				theme: optTheme || null
			});
			if (!res.ok) {
				optError = res.error;
				return;
			}
			optionsFolder = null;
			// The new bundle is on the shelf now; surface its link so it can be
			// copied again later without resharing the folder.
			refresh();
			const url = new URL(res.url, location.origin).href;
			if (await copyText(url)) {
				showToast(`Shared ${f.name}. Folder link copied.`, 'ok');
			} else {
				showToast(`Shared ${f.name}. Copy the link: ${res.url}`, 'ok');
			}
		} catch {
			optError = 'Could not reach the server. Check your connection.';
		} finally {
			sharingFolderId = null;
		}
	}

	function moveTo(docId: string, folderId: string | null) {
		setDocFolder(docId, folderId);
		entries = getShelf();
	}

	/* ----------------------------------------------------------- drag/drop */

	function onDragStart(e: DragEvent, id: string) {
		dragId = id;
		e.dataTransfer?.setData('text/plain', id);
		if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
	}

	function onDragEnd() {
		dragId = null;
		dropTarget = null;
	}

	function onDrop(folderId: string | null) {
		const id = dragId;
		onDragEnd();
		if (id) moveTo(id, folderId);
	}

	const chip =
		'rounded-sm border border-line bg-transparent px-2 py-1 text-[12px] text-ink-soft outline-none transition hover:border-iris hover:text-iris focus:border-iris dark:border-night-line dark:text-slate-400';
	const navBtn =
		'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[13px] transition';
	const rowBtn =
		'shrink-0 rounded-sm border border-line px-3 py-1 text-[13px] font-medium text-ink-soft transition hover:border-iris hover:text-iris active:scale-[0.98]';
	// Copy sits a step below Open/Options on the type scale, so the added
	// control does not make the row any taller than it already was.
	const copyBtn =
		'shrink-0 rounded-sm border border-line px-2 py-1 text-xs font-medium text-ink-soft transition hover:border-iris hover:text-iris active:scale-[0.98]';
	const railBtn =
		'rounded-sm px-1.5 py-1 text-[11px] text-ink-soft transition hover:text-iris dark:text-slate-500';
</script>

<svelte:head>
	<title>ShareMD library</title>
	<meta name="description" content="Docs shared from this browser." />
</svelte:head>

<main class="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
	<h1 class="font-display text-2xl font-bold tracking-tight">Library</h1>
	<p class="mt-1 text-sm text-ink-soft dark:text-slate-400">Docs you shared from this browser.</p>

	{#if entries.length || folders.length || bundles.length}
		<div class="mt-6 flex flex-col gap-6 lg:flex-row lg:items-start">
			<!-- folder rail -->
			<nav class="w-full shrink-0 lg:sticky lg:top-6 lg:w-64" aria-label="Library folders">
				<button
					type="button"
					class="{navBtn} {filter.kind === 'all'
						? 'bg-surface text-ink dark:bg-night-surface dark:text-white'
						: 'text-ink-soft hover:bg-surface dark:text-slate-400 dark:hover:bg-night-surface'}"
					aria-current={filter.kind === 'all' ? 'page' : undefined}
					onclick={() => (filter = { kind: 'all' })}
				>
					<span class="flex-1">All</span>
					<span class="tabular-nums opacity-60">{entries.length}</span>
				</button>

				<button
					type="button"
					class="{navBtn} {filter.kind === 'none'
						? 'bg-surface text-ink dark:bg-night-surface dark:text-white'
						: 'text-ink-soft hover:bg-surface dark:text-slate-400 dark:hover:bg-night-surface'}"
					aria-current={filter.kind === 'none' ? 'page' : undefined}
					ondragover={(e) => {
						e.preventDefault();
						dropTarget = '__none__';
					}}
					ondragleave={() => (dropTarget = dropTarget === '__none__' ? null : dropTarget)}
					ondrop={(e) => {
						e.preventDefault();
						onDrop(null);
					}}
					onclick={() => (filter = { kind: 'none' })}
				>
					<span class="flex-1">Uncategorised</span>
					<span class="tabular-nums opacity-60">{counts.none}</span>
				</button>

				{#if folders.length}
					<div class="my-2 border-t border-line dark:border-night-line"></div>
				{/if}

				{#each folders as f (f.id)}
					{@const folderBundle = latestBundle(f.id)}
					<div
						class="group flex flex-wrap items-center gap-1 {filter.kind === 'folder' && filter.id === f.id
							? 'bg-surface dark:bg-night-surface'
							: ''} {dropTarget === f.id ? 'ring-1 ring-iris' : ''} rounded-sm"
						ondragover={(e) => {
							e.preventDefault();
							dropTarget = f.id;
						}}
						ondragleave={() => (dropTarget = dropTarget === f.id ? null : dropTarget)}
						ondrop={(e) => {
							e.preventDefault();
							onDrop(f.id);
						}}
						role="none"
					>
						{#if renamingId === f.id}
							<!-- svelte-ignore a11y_autofocus -->
							<input
								bind:value={renameDraft}
								onblur={commitRename}
								onkeydown={(e) => {
									if (e.key === 'Enter') commitRename();
									if (e.key === 'Escape') renamingId = null;
								}}
								autofocus
								maxlength="40"
								class="my-1 w-full min-w-0 rounded-sm border border-line bg-surface px-2 py-1 text-[13px] text-ink outline-none focus:border-iris dark:border-night-line dark:bg-night-surface dark:text-white"
							/>
						{:else}
							<!-- The rail is 256px: four text actions do not fit beside a long folder
							     name, so the row wraps them onto their own line rather than
							     letting them spill over the doc list. -->
							<button
								type="button"
								class="{navBtn} {filter.kind === 'folder' && filter.id === f.id
									? 'text-ink dark:text-white'
									: 'text-ink-soft hover:bg-surface dark:text-slate-400 dark:hover:bg-night-surface'}"
								aria-current={filter.kind === 'folder' && filter.id === f.id ? 'page' : undefined}
								onclick={() => (filter = { kind: 'folder', id: f.id })}
							>
								<span class="min-w-0 flex-1 truncate">{f.name}</span>
								<span class="tabular-nums opacity-60">{counts.byFolder.get(f.id) ?? 0}</span>
							</button>
							<span class="hidden shrink-0 gap-0.5 group-hover:flex focus-within:flex lg:flex">
								{#if folderBundle}
									<button
										type="button"
										class={railBtn}
										onclick={() => copyBundle(folderBundle)}
										aria-label="Copy link for {f.name}">{copiedId === `bundle:${folderBundle.id}`
											? 'Copied'
											: 'Copy'}</button
									>
								{/if}
								<button
									type="button"
									class={railBtn}
									onclick={() => startRename(f)}
									aria-label="Rename {f.name}">Rename</button
								>
								<button
									type="button"
									class="{railBtn} disabled:opacity-40"
									onclick={() => openFolderOptions(f)}
									disabled={sharingFolderId === f.id}
									aria-label="Share {f.name} as one link">Share</button
								>
								<button
									type="button"
									class={railBtn}
									onclick={() => removeFolder(f)}
									aria-label="Delete {f.name}">Delete</button
								>
							</span>
						{/if}
					</div>
				{/each}

				{#if creating}
					<!-- svelte-ignore a11y_autofocus -->
					<input
						bind:value={newName}
						onblur={submitNewFolder}
						onkeydown={(e) => {
							if (e.key === 'Enter') submitNewFolder();
							if (e.key === 'Escape') creating = false;
						}}
						autofocus
						maxlength="40"
						placeholder="Folder name"
						class="my-1 w-full rounded-sm border border-line bg-surface px-2 py-1.5 text-[13px] text-ink outline-none focus:border-iris dark:border-night-line dark:bg-night-surface dark:text-white"
					/>
				{:else}
					<button
						type="button"
						class="{navBtn} mt-1 text-ink-soft hover:text-iris dark:text-slate-500"
						onclick={() => {
							creating = true;
							newName = '';
						}}
					>
						+ New folder
					</button>
				{/if}

				<p class="mt-3 text-[11px] leading-snug text-ink-soft/70 dark:text-slate-600">
					Drag a doc onto a folder to file it. Folders live in this browser only.
				</p>
			</nav>

			<!-- doc list -->
			<div class="min-w-0 flex-1">
				{#if visible.length}
					<ul
						class="divide-y divide-line overflow-hidden border border-line bg-surface dark:divide-night-line dark:border-night-line dark:bg-night-surface"
					>
						{#each visible as entry (entry.id)}
							<li
								class="flex flex-wrap items-center gap-1 px-3.5 py-2.5 sm:flex-nowrap {dragId === entry.id
									? 'opacity-40'
									: ''}"
								draggable="true"
								ondragstart={(e) => onDragStart(e, entry.id)}
								ondragend={onDragEnd}
							>
								<span class="min-w-0 flex-1">
									<span class="block truncate text-sm font-medium">{entry.title}</span>
									<span
										class="mt-0.5 block truncate font-mono text-[11px] text-ink-soft dark:text-slate-500"
										>{docPath(entry)}{entry.createdAt ? ` · ${timeAgo(entry.createdAt)}` : ''}</span
									>
								</span>
								<select
									class={chip}
									value={entry.folder ?? ''}
									aria-label="Folder for {entry.title}"
									onchange={(e) => moveTo(entry.id, e.currentTarget.value || null)}
								>
									<option value="">Uncategorised</option>
									{#each folders as f (f.id)}
										<option value={f.id}>{f.name}</option>
									{/each}
								</select>
<!-- A title and this many controls cannot share a phone-width line, so the
							     controls take their own row there rather than squeezing the title
							     to nothing or letting the row scroll sideways. -->
								<div class="flex w-full shrink-0 items-center gap-1 sm:w-auto">
									<a href={docPath(entry)} class={rowBtn}>Open</a>
									<button
										type="button"
										class={copyBtn}
										onclick={() => copyDoc(entry)}
										aria-label="Copy link for {entry.title}"
									>
										{copiedId === `doc:${entry.id}` ? 'Copied' : 'Copy'}
									</button>
									<button
										type="button"
										onclick={() => openDocSettings(entry)}
										class={rowBtn}
										aria-label="Link settings for {entry.title}"
									>
										Options
									</button>
									<DeleteDocButton id={entry.id} title={entry.title} {onDeleted} {onDeleteFailed} />
								</div>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="text-sm text-ink-soft dark:text-slate-400">
						{filter.kind === 'folder' ? 'No docs in this folder yet.' : 'Nothing here yet.'}
					</p>
				{/if}

				{#if bundleGroups.length}
					<section class="mt-6" aria-labelledby="folder-links-heading">
						<h2 id="folder-links-heading" class="font-display text-sm font-bold tracking-tight">
							Folder links
						</h2>
						<p class="mt-1 text-[13px] text-ink-soft dark:text-slate-400">
							Every folder link shared from this browser. Copy one instead of sharing the folder again —
							forgetting one only drops it from this list, it keeps working for anyone who has it.
						</p>

						{#each bundleGroups as group (group.folder?.id ?? '__uncategorised__')}
							<div class="mt-4">
								<h3 class="text-xs font-semibold tracking-wide text-ink-soft uppercase dark:text-slate-500">
									{group.folder?.name ?? 'Uncategorised'}
								</h3>
								<ul
									class="mt-1.5 divide-y divide-line border border-line bg-surface dark:divide-night-line dark:border-night-line dark:bg-night-surface"
								>
									{#each group.items as b (b.id)}
										<li class="flex items-center gap-1 px-3.5 py-2.5">
											<span class="min-w-0 flex-1">
												<span class="block truncate text-sm font-medium">{b.title}</span>
												<span
													class="mt-0.5 block truncate font-mono text-[11px] text-ink-soft dark:text-slate-500"
													>{bundlePath(b)}{b.createdAt ? ` · ${timeAgo(b.createdAt)}` : ''}</span
												>
											</span>
											<button
												type="button"
												class={copyBtn}
												onclick={() => copyBundle(b)}
												aria-label="Copy link for {b.title}"
											>
												{copiedId === `bundle:${b.id}` ? 'Copied' : 'Copy'}
											</button>
											<button
												type="button"
												class={rowBtn}
												onclick={() => openContributions(b)}
												aria-label="Manage contributed docs in {b.title}"
											>
												Added
											</button>
											<button
												type="button"
												class={rowBtn}
												onclick={() => forgetBundle(b)}
												aria-label="Forget the link for {b.title}"
											>
												Forget
											</button>
										</li>
									{/each}
								</ul>
							</div>
						{/each}
					</section>
				{/if}
			</div>
		</div>
	{:else}
		<p class="mt-6 text-sm text-ink-soft dark:text-slate-400">Nothing here yet. Shared docs appear here.</p>
	{/if}

	<a
		href="/"
		class="mt-6 inline-block rounded-sm border border-line px-4 py-2 text-sm font-medium text-ink-soft transition hover:border-iris hover:text-iris active:scale-[0.98]"
		>Back home</a
	>
</main>

<Toast message={toast?.message ?? null} kind={toast?.kind ?? 'ok'} />

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape' && optionsFolder) closeFolderOptions();
	}}
/>

{#if optionsFolder}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
		role="dialog"
		aria-modal="true"
		aria-labelledby="folder-options-title"
	>
		<div
			class="fixed inset-0 bg-black/70 backdrop-blur-xs"
			onclick={closeFolderOptions}
			aria-hidden="true"
		></div>

		<div
			class="rise relative z-10 w-full max-w-md border border-line bg-surface p-5 shadow-2xl dark:border-night-line dark:bg-night-surface"
		>
			<div class="flex items-start justify-between gap-4">
				<h2 id="folder-options-title" class="font-display text-[17px] font-bold tracking-tight text-ink">
					Share “{optionsFolder.name}”
				</h2>
				<button
					type="button"
					onclick={closeFolderOptions}
					class="font-mono text-xs text-ink-soft transition hover:text-iris"
					aria-label="Close folder link options">Esc</button
				>
			</div>

			<p class="mt-1.5 text-[13px] text-ink-soft dark:text-slate-400">
				One link to every doc in this folder. Leave everything blank for a plain share.
			</p>

			<div class="mt-4 space-y-3.5">
				<label class="block">
					<span class="mb-1.5 block text-sm font-medium">Custom slug</span>
					<input
						bind:value={optSlug}
						maxlength="32"
						placeholder="my-folder"
						autocomplete="off"
						spellcheck="false"
						class="w-full border bg-paper px-3 py-2 font-mono text-[13px] placeholder:text-ink-soft/50 focus:border-iris dark:bg-night dark:placeholder:text-slate-600 {slugOk
							? 'border-line dark:border-night-line'
							: 'border-iris'}"
					/>
					<span class="mt-1 block text-xs text-ink-soft dark:text-slate-500">
						a-z, 0-9 and dashes, 3 to 32 long.
					</span>
				</label>

				<label class="block">
					<span class="mb-1.5 block text-sm font-medium">Password</span>
					<input
						type="password"
						bind:value={optPassword}
						placeholder="Optional"
						autocomplete="new-password"
						class="w-full border bg-paper px-3 py-2 text-sm placeholder:text-ink-soft/50 focus:border-iris dark:bg-night dark:placeholder:text-slate-600 {optPasswordError
							? 'border-iris'
							: 'border-line dark:border-night-line'}"
					/>
					<span class="mt-1 block text-xs text-ink-soft dark:text-slate-500">
						{optPasswordError ?? 'Min 4 characters. Readers type this once to open the folder.'}
					</span>
				</label>

				<div class="grid grid-cols-2 gap-3">
					<label class="block">
						<span class="mb-1.5 block text-sm font-medium">Expires</span>
						<select
							bind:value={optExpiry}
							class="w-full border border-line bg-paper px-2.5 py-2 text-sm focus:border-iris dark:border-night-line dark:bg-night"
						>
							<option value="0">Never</option>
							<option value="3600">1 hour</option>
							<option value="86400">1 day</option>
							<option value="604800">7 days</option>
							<option value="2592000">30 days</option>
						</select>
					</label>
					<label class="block">
						<span class="mb-1.5 block text-sm font-medium">Max views</span>
						<input
							type="number"
							min="1"
							bind:value={optMaxViews}
							placeholder="No limit"
							class="w-full border bg-paper px-2.5 py-2 text-sm placeholder:text-ink-soft/50 focus:border-iris dark:bg-night dark:placeholder:text-slate-600 {optMaxViewsError
								? 'border-iris'
								: 'border-line dark:border-night-line'}"
						/>
					</label>
				</div>
				{#if optMaxViewsError}
					<p class="text-xs text-iris">{optMaxViewsError}</p>
				{/if}

				<label class="block">
					<span class="mb-1.5 block text-sm font-medium">Theme</span>
					<select
						bind:value={optTheme}
						class="w-full border border-line bg-paper px-2.5 py-2 text-sm focus:border-iris dark:border-night-line dark:bg-night"
					>
						<option value="">Reader's own</option>
						{#each themes as t (t.id)}
							<option value={t.id}>{t.label}</option>
						{/each}
					</select>
					<span class="mt-1 block text-xs text-ink-soft dark:text-slate-500">
						Pins a colourway on the folder page. Readers can still switch it for themselves.
					</span>
				</label>
			</div>

			{#if optError}
				<p class="mt-3 text-sm text-iris">{optError}</p>
			{/if}

			<div class="mt-5 flex items-center justify-end gap-2">
				<button
					type="button"
					onclick={closeFolderOptions}
					class="rounded-sm border border-line px-3.5 py-1.5 text-sm text-ink-soft transition hover:text-ink dark:border-night-line"
				>
					Cancel
				</button>
				<button
					type="button"
					onclick={() => optionsFolder && shareFolder(optionsFolder)}
					disabled={sharingFolderId !== null}
					class="btn-accent px-4 py-1.5 text-sm font-semibold transition disabled:opacity-50"
				>
					{sharingFolderId === optionsFolder.id ? 'Sharing…' : 'Share folder'}
				</button>
			</div>
		</div>
	</div>
{/if}

{#if settingsEntry}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
		role="dialog"
		aria-modal="true"
		aria-labelledby="doc-settings-title"
	>
		<div class="fixed inset-0 bg-black/70 backdrop-blur-xs" onclick={closeDocSettings} aria-hidden="true"></div>

		<div
			class="rise relative z-10 w-full max-w-md border border-line bg-surface p-5 shadow-2xl dark:border-night-line dark:bg-night-surface"
		>
			<div class="flex items-start justify-between gap-4">
				<h2 id="doc-settings-title" class="font-display text-[17px] font-bold tracking-tight text-ink">
					Link settings
				</h2>
				<button
					type="button"
					onclick={closeDocSettings}
					class="font-mono text-xs text-ink-soft transition hover:text-iris"
					aria-label="Close link settings">Esc</button
				>
			</div>

			<p class="mt-1.5 truncate text-[13px] text-ink-soft dark:text-slate-400">
				{settingsEntry.title}
			</p>
			<p class="mt-2 text-xs text-ink-soft dark:text-slate-500">
				Anything you leave alone stays as it is.
			</p>

			<div class="mt-4 space-y-3.5">
				<label class="block">
					<span class="mb-1.5 block text-sm font-medium">Custom slug</span>
					<input
						bind:value={sSlug}
						maxlength="32"
						placeholder="my-doc-name"
						autocomplete="off"
						spellcheck="false"
						class="w-full border bg-paper px-3 py-2 font-mono text-[13px] placeholder:text-ink-soft/50 focus:border-iris dark:bg-night dark:placeholder:text-slate-600 {sSlugOk
							? 'border-line dark:border-night-line'
							: 'border-iris'}"
					/>
					<span class="mt-1 block text-xs text-ink-soft dark:text-slate-500">
						{sSlugOk ? 'a-z, 0-9 and dashes, 3 to 32 long. Clear it to go back to the id link.' : 'Letters, numbers and dashes only.'}
					</span>
				</label>

				<label class="block">
					<span class="mb-1.5 block text-sm font-medium">Password</span>
					<input
						type="password"
						bind:value={sPassword}
						disabled={sRemovePassword}
						placeholder="Leave blank to keep it as it is"
						autocomplete="new-password"
						class="w-full border bg-paper px-3 py-2 text-sm placeholder:text-ink-soft/50 focus:border-iris disabled:opacity-50 dark:bg-night dark:placeholder:text-slate-600 {sPasswordError
							? 'border-iris'
							: 'border-line dark:border-night-line'}"
					/>
					<span class="mt-1 block text-xs text-ink-soft dark:text-slate-500">
						{sPasswordError ?? 'Set a new one, or leave blank to keep whatever is there.'}
					</span>
				</label>

				<label class="flex items-center gap-2 text-sm">
					<input type="checkbox" bind:checked={sRemovePassword} class="accent-iris" />
					<span class="text-ink-soft dark:text-slate-400">Remove the password from this link</span>
				</label>

				<div class="grid grid-cols-2 gap-3">
					<label class="block">
						<span class="mb-1.5 block text-sm font-medium">Expires</span>
						<select
							bind:value={sExpiry}
							class="w-full border border-line bg-paper px-2.5 py-2 text-sm focus:border-iris dark:border-night-line dark:bg-night"
						>
							<option value="keep">Leave unchanged</option>
							<option value="0">Never</option>
							<option value="3600">1 hour</option>
							<option value="86400">1 day</option>
							<option value="604800">7 days</option>
							<option value="2592000">30 days</option>
						</select>
					</label>
					<label class="block">
						<span class="mb-1.5 block text-sm font-medium">Max views</span>
						<input
							type="number"
							min="1"
							step="1"
							bind:value={sMaxViews}
							disabled={sNoLimit}
							placeholder="Leave blank"
							class="w-full border bg-paper px-2.5 py-2 text-sm placeholder:text-ink-soft/50 focus:border-iris disabled:opacity-50 dark:bg-night dark:placeholder:text-slate-600 {sMaxViewsError
								? 'border-iris'
								: 'border-line dark:border-night-line'}"
						/>
					</label>
				</div>
				<label class="flex items-center gap-2 text-sm">
					<input type="checkbox" bind:checked={sNoLimit} class="accent-iris" />
					<span class="text-ink-soft dark:text-slate-400">No view limit</span>
				</label>
				{#if sMaxViewsError}
					<p class="text-xs text-iris">{sMaxViewsError}</p>
				{/if}
			</div>

			{#if sError}
				<p class="mt-3 text-sm text-iris">{sError}</p>
			{/if}

			<div class="mt-5 flex items-center justify-end gap-2">
				<button
					type="button"
					onclick={closeDocSettings}
					class="rounded-sm border border-line px-3.5 py-1.5 text-sm text-ink-soft transition hover:text-ink dark:border-night-line"
				>
					Cancel
				</button>
				<button
					type="button"
					onclick={saveDocSettings}
					disabled={sBusy}
					class="btn-accent px-4 py-1.5 text-sm font-semibold transition disabled:opacity-50"
				>
					{sBusy ? 'Saving…' : 'Save settings'}
				</button>
			</div>
		</div>
	</div>
{/if}

{#if contribBundle}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
		role="dialog"
		aria-modal="true"
		aria-labelledby="contrib-title"
	>
		<div class="fixed inset-0 bg-black/70 backdrop-blur-xs" onclick={closeContributions} aria-hidden="true"></div>

		<div
			class="rise relative z-10 w-full max-w-md border border-line bg-surface p-5 shadow-2xl dark:border-night-line dark:bg-night-surface"
		>
			<div class="flex items-start justify-between gap-4">
				<h2 id="contrib-title" class="font-display text-[17px] font-bold tracking-tight text-ink">
					Added to this folder
				</h2>
				<button
					type="button"
					onclick={closeContributions}
					class="font-mono text-xs text-ink-soft transition hover:text-iris"
					aria-label="Close contributed docs">Esc</button
				>
			</div>

			<p class="mt-1.5 truncate text-[13px] text-ink-soft dark:text-slate-400">{contribBundle.title}</p>
			<p class="mt-2 text-xs text-ink-soft dark:text-slate-500">
				Docs other people added using the folder password. Removing one deletes it for everyone. Your own
				docs are not listed here.
			</p>

			<div class="mt-4 min-h-[4rem]">
				{#if contribLoading}
					<p class="text-sm text-ink-soft dark:text-slate-400">Loading…</p>
				{:else if contributions.length === 0}
					<p class="text-sm text-ink-soft dark:text-slate-400">
						Nobody has added anything to this folder yet.
					</p>
				{:else}
					<ul class="divide-y divide-line border border-line dark:divide-night-line dark:border-night-line">
						{#each contributions as c (c.docId)}
							<li class="flex items-center gap-2 px-3 py-2.5">
								<span class="min-w-0 flex-1">
									<span class="block truncate text-sm font-medium">{c.title}</span>
									<span class="mt-0.5 block truncate text-[11px] text-ink-soft dark:text-slate-500">
										added by {c.contributorName}{c.createdAt ? ` · ${timeAgo(c.createdAt)}` : ''}
									</span>
								</span>
								<button
									type="button"
									class="shrink-0 rounded-sm border border-line px-3 py-1 text-[13px] font-medium text-ink-soft transition hover:border-iris hover:text-iris disabled:opacity-40 dark:border-night-line"
									disabled={removingDocId !== null}
									onclick={() => removeContributedDoc(c)}
									aria-label="Remove {c.title}"
								>
									{removingDocId === c.docId ? '…' : 'Remove'}
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			</div>

			{#if contribError}
				<p class="mt-3 text-sm text-iris" role="alert">{contribError}</p>
			{/if}

			<div class="mt-5 flex items-center justify-end">
				<button
					type="button"
					onclick={closeContributions}
					class="rounded-sm border border-line px-3.5 py-1.5 text-sm text-ink-soft transition hover:text-ink dark:border-night-line"
				>
					Close
				</button>
			</div>
		</div>
	</div>
{/if}