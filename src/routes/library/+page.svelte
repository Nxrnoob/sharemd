<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Toast from '$lib/components/Toast.svelte';
	import DeleteDocButton from '$lib/components/DeleteDocButton.svelte';
	import FileGlyph from '$lib/components/FileGlyph.svelte';
	import DocTile from '$lib/components/DocTile.svelte';
	import FileRow from '$lib/components/FileRow.svelte';
	import PaneHeader from '$lib/components/PaneHeader.svelte';
	import SideRow from '$lib/components/SideRow.svelte';
	import StatusBar from '$lib/components/StatusBar.svelte';
	import { FILE_BOX_DASHED, FILE_CONTROL, RULE, SUBTLE } from '$lib/components/fileSkin';
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
	//
	// Shape: the owner's own view of a shared folder, which the reader sees at
	// /b/[id]. Same rule as that page — the container is typographic and the
	// contents are boxed — so the rail and the header carry no boxes at all and
	// every doc is a `FileRow`, the list-dressed twin of the reader's `DocTile`.

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

	/**
	 * Everything on this page is client-only — the shelf, the folders and the
	 * folder links all live in localStorage, so the first paint has nothing.
	 * `ready` only gates the *empty-state copy*: the page frame, the rail and
	 * the counts render either way, but a returning owner should not see
	 * "Nothing here yet" flash before their docs arrive.
	 */
	let ready = $state(false);

	onMount(() => {
		entries = getShelf();
		folders = getFolders();
		bundles = getBundles();
		ready = true;
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
	 * folder is recovered by intersecting those ids with the live shelf.
	 *
	 * Folder links are folded into the rail rather than kept as a second list.
	 * A shared folder and the link that was sent for it are one thing the owner
	 * thinks about, and this way they are drawn as one thing: the link hangs
	 * off its folder's row, on a hairline spine, carrying its own Copy / Added
	 * / Forget. A bundle whose folder is gone (or whose docs all moved out)
	 * would otherwise have nowhere to live, so it lands under Uncategorised —
	 * which is exactly where its docs are — rather than disappearing.
	 */
	const linksFor = $derived.by(() => {
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
		return { byFolder: grouped, orphans };
	});

	/** Links belonging to one folder row, or the orphans under Uncategorised. */
	function folderLinks(folderId: string | null): BundleEntry[] {
		return folderId === null ? linksFor.orphans : (linksFor.byFolder.get(folderId) ?? []);
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

	let armedFolderId = $state<string | null>(null);
	let armFolderTimer: ReturnType<typeof setTimeout> | null = null;

	function requestRemoveFolder(f: Folder) {
		if (armedFolderId === f.id) {
			if (armFolderTimer) clearTimeout(armFolderTimer);
			armedFolderId = null;
			deleteFolder(f.id);
			const cur = filter;
			if (cur.kind === 'folder' && cur.id === f.id) {
				filter = { kind: 'all' };
			}
			refresh();
			showToast(`"${f.name}" deleted. Its docs moved to Uncategorised.`);
		} else {
			armedFolderId = f.id;
			if (armFolderTimer) clearTimeout(armFolderTimer);
			armFolderTimer = setTimeout(() => {
				armedFolderId = null;
			}, 3500);
		}
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

	/* ------------------------------------------------------------ chrome */

	/**
	 * The pane header describes what this container *is*; the status bars answer
	 * the separate questions of what it holds and what the current filter shows.
	 * Counts deliberately stay out of the header — that is the folder page's rule
	 * too, and a header that also counts stops being the container's name and
	 * starts competing with what it holds.
	 */
	const activeFolderName = $derived.by(() => {
		const f = filter;
		if (f.kind === 'folder') {
			return folders.find((x) => x.id === f.id)?.name ?? null;
		}
		if (f.kind === 'none') {
			return 'Uncategorised';
		}
		return null;
	});

	const headerTitle = $derived(activeFolderName ? activeFolderName : 'Shared from this browser');
	const headerEyebrow = $derived(filter.kind === 'folder' ? 'Folder' : 'Library');
	const headerMeta = $derived(
		activeFolderName
			? `Filing into ${activeFolderName}`
			: 'Docs you have shared, and the folder links you have sent.'
	);
	const newDocHref = $derived.by(() => {
		const f = filter;
		return f.kind === 'folder' ? `/?folder=${encodeURIComponent(f.id)}` : '/';
	});

	const docsStatus = $derived.by(() => {
		// Captured to a local so the narrowing survives into the callbacks below.
		const f = filter;
		const total = entries.length;
		if (f.kind === 'all') return `${total} ${total === 1 ? 'doc' : 'docs'}`;
		const n = visible.length;
		if (f.kind === 'none') {
			return `${n} of ${total} ${total === 1 ? 'doc' : 'docs'} · uncategorised`;
		}
		const name = folders.find((x) => x.id === f.id)?.name;
		return `${n} of ${total} ${total === 1 ? 'doc' : 'docs'} · in ${name ?? 'that folder'}`;
	});

	const linksStatus = $derived(
		`${bundles.length} ${bundles.length === 1 ? 'link' : 'links'} shared`
	);
	/** Whether anything at all is worth drawing a two-pane layout for. */
	const hasShelf = $derived(entries.length > 0 || folders.length > 0 || bundles.length > 0);

	/** The small quiet text button the rail's revealed actions use. */
	const railBtn =
		'rounded-sm px-1.5 py-1 text-[11px] text-ink-soft transition hover:text-iris focus-visible:text-iris dark:text-slate-500';

	/**
	 * Inline rename / create input, matching the rest of the form styling.
	 * `bg-surface` not `bg-paper`: the rail has no panel behind it, so the input
	 * has to supply its own fill to stay legible against the page ground.
	 */
	const railInput =
		'my-1 w-full min-w-0 rounded-sm border border-line bg-surface px-2 py-1 text-[13px] text-ink outline-none focus:border-iris dark:border-night-line dark:bg-night-surface dark:text-white';

	let viewMode = $state<'list' | 'grid'>('list');

	function setViewMode(mode: 'list' | 'grid') {
		viewMode = mode;
		try {
			localStorage.setItem('sharemd-view-mode', mode);
		} catch {}
	}
	/* ----------------------------------------------------------- drag/drop */
	let externalDragOver = $state(false);

	async function handleExternalFile(file: File, targetFolderId?: string | null) {
		if (
			!file.name.endsWith('.md') &&
			!file.name.endsWith('.markdown') &&
			!file.name.endsWith('.txt')
		) {
			showToast('Drop markdown (.md) or text files only.');
			return;
		}
		try {
			const text = await file.text();
			const titleMatch = text.match(/^#\s+(.+)$/m);
			const title = titleMatch ? titleMatch[1].trim() : file.name.replace(/\.[^/.]+$/, '');
			const folder = targetFolderId ?? (filter.kind === 'folder' ? filter.id : null);
			sessionStorage.setItem(
				'sharemd-pending-drop',
				JSON.stringify({
					title,
					markdown: text,
					folder
				})
			);
			goto(folder ? `/?folder=${encodeURIComponent(folder)}` : '/');
		} catch {
			showToast('Failed to read dropped file.');
		}
	}

	function onWindowDragOver(e: DragEvent) {
		if (e.dataTransfer?.types?.includes('Files')) {
			e.preventDefault();
			externalDragOver = true;
		}
	}

	function onWindowDragLeave(e: DragEvent) {
		if (e.clientX <= 0 || e.clientY <= 0) {
			externalDragOver = false;
		}
	}

	function onWindowDrop(e: DragEvent) {
		if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
			e.preventDefault();
			externalDragOver = false;
			const file = e.dataTransfer.files[0];
			if (file) handleExternalFile(file);
		}
	}

	function onFolderDrop(e: DragEvent, folderId: string | null) {
		e.preventDefault();
		dropTarget = null;
		externalDragOver = false;
		if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
			const file = e.dataTransfer.files[0];
			if (file) handleExternalFile(file, folderId);
			return;
		}
		onDrop(folderId);
	}

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

	onMount(() => {
		try {
			const savedMode = localStorage.getItem('sharemd-view-mode');
			if (savedMode === 'list' || savedMode === 'grid') viewMode = savedMode;
		} catch {}
		window.addEventListener('dragover', onWindowDragOver);
		window.addEventListener('dragleave', onWindowDragLeave);
		window.addEventListener('drop', onWindowDrop);
		return () => {
			window.removeEventListener('dragover', onWindowDragOver);
			window.removeEventListener('dragleave', onWindowDragLeave);
			window.removeEventListener('drop', onWindowDrop);
		};
	});
</script>

<svelte:head>
	<title>ShareMD library</title>
	<meta name="description" content="Docs shared from this browser." />
</svelte:head>

<main class="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6 sm:py-14">
{#if externalDragOver}
	<div class="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-surface/80 backdrop-blur-xs p-6">
		<div class="flex flex-col items-center gap-3 rounded-lg border-2 border-dashed border-iris bg-paper p-8 text-center shadow-xl dark:bg-night">
			<FileGlyph kind="doc" class="size-10 text-iris" />
			<p class="text-base font-semibold text-ink dark:text-white">Drop markdown file here</p>
			<p class="text-xs text-ink-soft dark:text-slate-400">
				{activeFolderName ? `Will open in editor filed into ${activeFolderName}` : 'Will open in editor'}
			</p>
		</div>
	</div>
{/if}
	<!-- The container is typographic and rule-divided; everything inside it is
	     boxed. Same `PaneHeader` the folder page uses, so an owner and a reader
	     land on the same chrome. -->
	<PaneHeader eyebrow={headerEyebrow} title={headerTitle}>
		{#snippet meta()}
			<div class="flex flex-wrap items-center justify-between gap-3">
				<span>{headerMeta}</span>
				<div class="flex items-center gap-2">
					<div class="inline-flex rounded-sm border border-line p-0.5 dark:border-night-line">
						<button
							type="button"
							onclick={() => setViewMode('list')}
							class="rounded-xs p-1 transition {viewMode === 'list'
								? 'bg-line/60 text-ink dark:bg-night-line/80 dark:text-white'
								: 'text-ink-soft hover:text-ink dark:text-slate-500'}"
							aria-label="List view"
							title="List view"
						>
							<svg class="size-3.5" viewBox="0 0 16 16" fill="currentColor">
								<path d="M2 3.5a.75.75 0 0 1 .75-.75h10.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 3.5Zm0 4.5a.75.75 0 0 1 .75-.75h10.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 8Zm0 4.5a.75.75 0 0 1 .75-.75h10.5a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1-.75-.75Z" />
							</svg>
						</button>
						<button
							type="button"
							onclick={() => setViewMode('grid')}
							class="rounded-xs p-1 transition {viewMode === 'grid'
								? 'bg-line/60 text-ink dark:bg-night-line/80 dark:text-white'
								: 'text-ink-soft hover:text-ink dark:text-slate-500'}"
							aria-label="Grid view"
							title="Grid view"
						>
							<svg class="size-3.5" viewBox="0 0 16 16" fill="currentColor">
								<path d="M2.5 2.5h4v4h-4v-4Zm7 0h4v4h-4v-4Zm-7 7h4v4h-4v-4Zm7 0h4v4h-4v-4Z" />
							</svg>
						</button>
					</div>
					<a
						href={newDocHref}
						class="btn-accent inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-semibold transition"
					>
						<FileGlyph kind="plus" class="size-4 shrink-0" />
						<span>New doc</span>
					</a>
				</div>
			</div>
		{/snippet}
	</PaneHeader>

	{#if !ready}
		<!-- Everything on this page lives in localStorage, so the first paint has
		     nothing to show. Hold the page's height rather than flashing "Nothing
		     here yet" at a returning owner for one frame. -->
		<div class="min-h-[22rem]"></div>
	{:else if !hasShelf}
		<div class="mt-6 border border-dashed px-5 py-14 text-center {RULE}">
			<p class="text-[15px] font-medium">This library is empty.</p>
			<p class="mt-1.5 text-sm {SUBTLE}">
				Share a doc and it lands here, along with any folder links you make.
			</p>
			<a
				href="/"
				class="btn-accent mt-6 inline-flex items-center justify-center px-5 py-2.5 text-[15px] font-semibold transition"
			>
				Share your first doc
			</a>
		</div>
	{:else}
		<div class="mt-6 flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
			<!-- ============================================ the rail
			     A file manager's sidebar, which is exactly what this is: it filters
			     the pane on the right by where a doc is filed, it is a drop target
			     for filing by drag, and it is where a folder's own share lives. It is
			     a container, so it stays typographic — no panel, no box — just rows
			     on the page ground, divided by a hairline. Every row is a `SideRow`,
			     so the filters, the folders and their links cannot drift apart. -->
			<nav
				class="w-full shrink-0 lg:sticky lg:top-6 lg:w-80 lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto lg:overscroll-contain lg:pb-2"
				aria-label="Library folders"
			>
				<SideRow
					label="All"
					glyph="all"
					count={entries.length}
					active={filter.kind === 'all'}
					onclick={() => (filter = { kind: 'all' })}
					title="Every doc you have shared"
				/>

				<!-- Uncategorised is a drop target in its own right: dragging a doc
				     back onto it is how you unfile. -->
			<SideRow
				label="Uncategorised"
				glyph="unfiled"
				count={counts.none}
				active={filter.kind === 'none'}
				onclick={() => (filter = { kind: 'none' })}
				dropping={dropTarget === '__none__'}
				ondragover={(e) => {
					e.preventDefault();
					dropTarget = '__none__';
				}}
				ondragleave={() => (dropTarget = dropTarget === '__none__' ? null : dropTarget)}
				ondrop={(e) => onFolderDrop(e, null)}
			/>

			<!-- A shared folder and the link that was sent for it are one thing the
			     owner thinks about, so they are drawn as one thing: the link hangs
			     off its folder's row. A link whose folder is gone lives under
			     Uncategorised, which is where its docs ended up too — so the two
			     places below share one row definition instead of two drifting
			     copies of the same three buttons. -->
			{#snippet linkRow(b: BundleEntry)}
				<SideRow
					child
					label={bundlePath(b)}
					glyph="link"
					href={bundlePath(b)}
					ariaLabel="Folder link for {b.title}"
					title="{b.title} — opened {b.createdAt ? timeAgo(b.createdAt) : 'earlier'}"
				>
					{#snippet actions()}
						<button
							type="button"
							class={railBtn}
							onclick={() => copyBundle(b)}
							aria-label="Copy link for {b.title}"
							title="Copy folder link"
						>{copiedId === `bundle:${b.id}` ? 'Copied' : 'Copy'}</button>
						<button
							type="button"
							class={railBtn}
							onclick={() => openContributions(b)}
							aria-label="Manage contributed docs in {b.title}"
							title="Docs other people added"
						>Added</button>
						<button
							type="button"
							class={railBtn}
							onclick={() => forgetBundle(b)}
							aria-label="Forget the link for {b.title}"
							title="Forget (the link keeps working for anyone who has it)"
						>Forget</button>
					{/snippet}
				</SideRow>
			{/snippet}

			{#each folderLinks(null) as b (b.id)}
				{@render linkRow(b)}
			{/each}


				{#if folders.length}
					<div class="my-2 border-t {RULE}"></div>
				{/if}

				{#each folders as f (f.id)}
					{@const isActive = filter.kind === 'folder' && filter.id === f.id}
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
							aria-label="New name for {f.name}"
							class={railInput}
						/>
					{:else}
						<SideRow
							label={f.name}
							glyph="folder"
							count={counts.byFolder.get(f.id) ?? 0}
							active={isActive}
							title="Show only {f.name}"
							onclick={() => (filter = { kind: 'folder', id: f.id })}
							dropping={dropTarget === f.id}
							ondragover={(e) => {
								e.preventDefault();
								dropTarget = f.id;
							}}
							ondragleave={() => (dropTarget = dropTarget === f.id ? null : dropTarget)}
							ondrop={(e) => onFolderDrop(e, f.id)}
						>
							{#snippet actions()}
								<button
									type="button"
									class="{railBtn} disabled:opacity-40"
									onclick={() => openFolderOptions(f)}
									disabled={sharingFolderId === f.id}
									aria-label="Share {f.name} as one link"
									title="Share as one link"
								>{sharingFolderId === f.id ? '…' : 'Share'}</button>
								<button
									type="button"
									class={railBtn}
									onclick={() => startRename(f)}
									aria-label="Rename {f.name}"
									title="Rename"
								>Rename</button>
								<button
									type="button"
									class="{railBtn} transition {armedFolderId === f.id ? 'font-semibold text-red-500 hover:text-red-600 dark:text-red-400' : ''}"
									onclick={() => requestRemoveFolder(f)}
									aria-label={armedFolderId === f.id ? `Confirm delete ${f.name}` : `Delete ${f.name}`}
									title={armedFolderId === f.id ? 'Click again to confirm delete' : 'Delete: its docs move to Uncategorised'}
								>{armedFolderId === f.id ? 'Sure?' : 'Delete'}</button>
							{/snippet}
						</SideRow>
					{/if}

					{#each folderLinks(f.id) as b (b.id)}
						{@render linkRow(b)}
					{/each}
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
						aria-label="New folder name"
						class={railInput}
					/>
				{:else}
					<!-- Creating a folder is a primary action here, so it wears the same
					     dashed treatment as the "add a doc" tile in a folder's grid. -->
					<button
						type="button"
						class="mt-1 flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[13px] font-medium transition hover:border-iris hover:text-iris {FILE_BOX_DASHED}"
						onclick={() => {
							creating = true;
							newName = '';
						}}
					>
						<FileGlyph kind="plus" class="size-4 shrink-0" />
						New folder
					</button>
				{/if}

				<p class="mt-3 text-[11px] leading-snug text-ink-soft/70 dark:text-slate-600">
					Drag a doc onto a folder to file it, or use the menu on any row. Folders and these
					links live in this browser only.
				</p>

				<!-- The rail has its own tally for the same reason the pane does:
				     counts belong on a status bar, never in the header. -->
				<StatusBar text={linksStatus} />
			</nav>

			<!-- ============================================ contents -->
			<div class="min-w-0 flex-1">
				{#if visible.length}
					{#if viewMode === 'list'}
						<ul class="flex flex-col gap-2">
							{#each visible as entry (entry.id)}
								<!-- The name is the link, exactly as in any file manager. `Open` stays
								     in the revealed actions so the explicit verb is not lost, and it
								     costs the row nothing at rest because those actions are laid over
								     the name rather than reserving space beside it. -->
								<FileRow
									label={entry.title}
									href={docPath(entry)}
									draggable
									ondragstart={(e) => onDragStart(e, entry.id)}
									ondragend={onDragEnd}
									dimmed={dragId === entry.id}
								>
									{#snippet meta()}
										{docPath(entry)}{entry.createdAt ? ` · ${timeAgo(entry.createdAt)}` : ''}
									{/snippet}
									{#snippet control()}
										<!-- Capped: an uncapped select sizes to its longest folder name and
										     starves the document title of the row. -->
										<select
											class="{FILE_CONTROL} w-36 truncate bg-paper sm:w-40"
											value={entry.folder ?? ''}
											aria-label="Folder for {entry.title}"
											onchange={(e) => moveTo(entry.id, e.currentTarget.value || null)}
										>
											<option value="">Uncategorised</option>
											{#each folders as f (f.id)}
												<option value={f.id}>{f.name}</option>
											{/each}
										</select>
									{/snippet}
									{#snippet actions()}
										<a href={docPath(entry)} class={FILE_CONTROL}>Open</a>
										<button
											type="button"
											class={FILE_CONTROL}
											onclick={() => copyDoc(entry)}
											aria-label="Copy link for {entry.title}"
										>{copiedId === `doc:${entry.id}` ? 'Copied' : 'Copy'}</button>
										<button
											type="button"
											class={FILE_CONTROL}
											onclick={() => openDocSettings(entry)}
											aria-label="Link settings for {entry.title}"
										>Options</button>
										<!-- Delete keeps its own arm-then-confirm button; the frame around it
										     is here so a bare × is not the only unboxed thing in a row of
										     boxed controls. -->
										<span
											class="flex shrink-0 items-center rounded-sm border border-line px-2 py-1 dark:border-night-line"
										>
											<DeleteDocButton
												id={entry.id}
												title={entry.title}
												{onDeleted}
												{onDeleteFailed}
											/>
										</span>
									{/snippet}
								</FileRow>
							{/each}
						</ul>
					{:else}
						<ul class="grid grid-cols-[repeat(auto-fill,minmax(min(148px,100%),1fr))] gap-3 sm:grid-cols-[repeat(auto-fill,minmax(176px,1fr))] sm:gap-4">
							{#each visible as entry (entry.id)}
								<li class="rise min-w-0">
									<DocTile
										label={entry.title}
										href={docPath(entry)}
										tooltip="{entry.title} · {docPath(entry)}"
									>
										{#snippet meta()}
											<span>{entry.createdAt ? timeAgo(entry.createdAt) : docPath(entry)}</span>
										{/snippet}
									</DocTile>
								</li>
							{/each}
						</ul>
					{/if}
				{:else}
					<div class="border border-dashed px-5 py-12 text-center {RULE}">
						<p class="text-[15px] font-medium">
							{filter.kind === 'folder' ? 'This folder is empty.' : 'Nothing here yet.'}
						</p>
						<p class="mt-1.5 text-sm {SUBTLE}">
							{filter.kind === 'folder'
								? 'Drag a doc onto this folder, or pick a folder from any row.'
								: 'Share a doc and it lands here.'}
						</p>
					</div>
				{/if}

				<StatusBar text={docsStatus} />
			</div>
		</div>
	{/if}

	<div class="mt-10 flex flex-wrap items-center justify-center gap-3 border-t pt-8 {RULE}">
		<a
			href="/"
			class="btn-accent inline-flex items-center justify-center px-5 py-2.5 text-[15px] font-semibold transition"
		>
			Share a new doc
		</a>
	</div>
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