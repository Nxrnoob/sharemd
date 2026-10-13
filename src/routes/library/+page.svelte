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
		type ShelfEntry,
		type Folder
	} from '$lib/shelf';
	import type { DeleteResult } from '$lib/shelf';

	// Library: docs shared from this browser (the silent-token shelf).
	// Client-only list, no server load, no per-row fetch. Viewers never
	// see delete UI anywhere; only shelf owners do, here and on landing.
	//
	// Folders are local metadata over that shelf — there is no server-side
	// owner to hang them off. Single-level by design; see src/lib/shelf.ts.

	type Filter = { kind: 'all' } | { kind: 'none' } | { kind: 'folder'; id: string };

	let entries = $state<ShelfEntry[]>([]);
	let folders = $state<Folder[]>([]);
	let filter = $state<Filter>({ kind: 'all' });
	let toast = $state<{ message: string; kind: 'ok' | 'error' } | null>(null);
	let toastTimer: ReturnType<typeof setTimeout> | null = null;

	let creating = $state(false);
	let newName = $state('');
	let renamingId = $state<string | null>(null);
	let renameDraft = $state('');

	let dragId = $state<string | null>(null);
	/** folder id, '__none__' for the uncategorised drop target, null = idle */
	let dropTarget = $state<string | null>(null);

	onMount(() => {
		entries = getShelf();
		folders = getFolders();
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

	function openHref(e: ShelfEntry): string {
		return `/s/${e.slug ?? e.id}`;
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
</script>

<svelte:head>
	<title>ShareMD library</title>
	<meta name="description" content="Docs shared from this browser." />
</svelte:head>

<main class="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
	<h1 class="font-display text-2xl font-bold tracking-tight">Library</h1>
	<p class="mt-1 text-sm text-ink-soft dark:text-slate-400">Docs you shared from this browser.</p>

	{#if entries.length || folders.length}
		<div class="mt-6 flex flex-col gap-6 lg:flex-row lg:items-start">
			<!-- folder rail -->
			<nav class="w-full shrink-0 lg:sticky lg:top-6 lg:w-52" aria-label="Library folders">
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
					<div
						class="flex items-center gap-1 {filter.kind === 'folder' && filter.id === f.id
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
							<span class="hidden shrink-0 gap-0.5 group-hover:flex lg:flex">
								<button
									type="button"
									class="rounded-sm px-1.5 py-1 text-[11px] text-ink-soft transition hover:text-iris dark:text-slate-500"
									onclick={() => startRename(f)}
									aria-label="Rename {f.name}">Rename</button
								>
								<button
									type="button"
									class="rounded-sm px-1.5 py-1 text-[11px] text-ink-soft transition hover:text-iris dark:text-slate-500"
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
								class="flex items-center gap-1 px-3.5 py-2.5 {dragId === entry.id ? 'opacity-40' : ''}"
								draggable="true"
								ondragstart={(e) => onDragStart(e, entry.id)}
								ondragend={onDragEnd}
							>
								<span class="min-w-0 flex-1">
									<span class="block truncate text-sm font-medium">{entry.title}</span>
									<span
										class="mt-0.5 block truncate font-mono text-[11px] text-ink-soft dark:text-slate-500"
										>/s/{entry.slug ?? entry.id}{entry.createdAt ? ` · ${timeAgo(entry.createdAt)}` : ''}</span
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
								<a
									href={openHref(entry)}
									class="shrink-0 rounded-sm border border-line px-3 py-1 text-[13px] font-medium text-ink-soft transition hover:border-iris hover:text-iris active:scale-[0.98]"
									>Open</a
								>
								<DeleteDocButton id={entry.id} title={entry.title} {onDeleted} {onDeleteFailed} />
							</li>
						{/each}
					</ul>
				{:else}
					<p class="text-sm text-ink-soft dark:text-slate-400">
						{filter.kind === 'folder' ? 'No docs in this folder yet.' : 'Nothing here yet.'}
					</p>
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