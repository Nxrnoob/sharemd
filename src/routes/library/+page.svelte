<script lang="ts">
	import { onMount } from 'svelte';
	import Toast from '$lib/components/Toast.svelte';
	import DeleteDocButton from '$lib/components/DeleteDocButton.svelte';
	import { getShelf, type ShelfEntry } from '$lib/shelf';
	import type { DeleteResult } from '$lib/shelf';

	// Library: docs shared from this browser (the silent-token shelf).
	// Client-only list, no server load, no per-row fetch. Viewers never
	// see delete UI anywhere; only shelf owners do, here and on landing.

	let entries = $state<ShelfEntry[]>([]);
	let toast = $state<{ message: string; kind: 'ok' | 'error' } | null>(null);
	let toastTimer: ReturnType<typeof setTimeout> | null = null;

	onMount(() => {
		entries = getShelf();
	});

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
</script>

<svelte:head>
	<title>ShareMD library</title>
	<meta name="description" content="Docs shared from this browser." />
</svelte:head>

<main class="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
	<h1 class="font-display text-2xl font-bold tracking-tight">Library</h1>
	<p class="mt-1 text-sm text-ink-soft dark:text-slate-400">Docs you shared from this browser.</p>

	{#if entries.length}
		<ul class="mt-6 divide-y divide-line overflow-hidden border border-line bg-surface dark:divide-night-line dark:border-night-line dark:bg-night-surface">
			{#each entries as entry (entry.id)}
				<li class="flex items-center gap-1 px-3.5 py-2.5">
					<span class="min-w-0 flex-1">
						<span class="block truncate text-sm font-medium">{entry.title}</span>
						<span class="mt-0.5 block truncate font-mono text-[11px] text-ink-soft dark:text-slate-500"
							>/s/{entry.slug ?? entry.id}{entry.createdAt ? ` · ${timeAgo(entry.createdAt)}` : ''}</span
						>
					</span>
					<a
						href={openHref(entry)}
						class="shrink-0 border border-line px-3 py-1 text-[13px] font-medium text-ink-soft transition hover:border-iris hover:text-iris"
						>Open</a
					>
					<DeleteDocButton id={entry.id} title={entry.title} {onDeleted} {onDeleteFailed} />
				</li>
			{/each}
		</ul>
	{:else}
		<p class="mt-6 text-sm text-ink-soft dark:text-slate-400">Nothing here yet. Shared docs appear here.</p>
		<a
			href="/"
			class="mt-4 inline-block border border-line px-4 py-2 text-sm font-medium text-ink-soft transition hover:border-iris hover:text-iris"
			>Back home</a
		>
	{/if}
</main>

<Toast message={toast?.message ?? null} kind={toast?.kind ?? 'ok'} />
