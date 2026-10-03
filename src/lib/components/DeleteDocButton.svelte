<script lang="ts">
	import { onDestroy } from 'svelte';
	import { deleteOwnedDoc, getShelf, removeFromShelf } from '$lib/shelf';
	import type { DeleteResult } from '$lib/shelf';

	// Bare-glyph delete with an arm-then-confirm step, no modal:
	// first click arms ("Sure?"), second click deletes. No box, no fill;
	// danger is tonal text only. Never renders tokens.

	interface Props {
		id: string;
		title: string;
		onDeleted: (id: string) => void;
		onDeleteFailed: (reason: Exclude<DeleteResult, 'deleted'>) => void;
	}

	let { id, title, onDeleted, onDeleteFailed }: Props = $props();

	let armed = $state(false);
	let working = $state(false);
	let timer: ReturnType<typeof setTimeout> | null = null;

	function disarm() {
		armed = false;
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
	}

	onDestroy(() => {
		if (timer) clearTimeout(timer);
	});

	async function handle() {
		if (working) return;
		if (!armed) {
			armed = true;
			if (timer) clearTimeout(timer);
			timer = setTimeout(() => {
				armed = false;
				timer = null;
			}, 4000);
			return;
		}
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
		const entry = getShelf().find((e) => e.id === id);
		if (!entry) {
			disarm();
			onDeleteFailed('missing');
			return;
		}
		working = true;
		const res = await deleteOwnedDoc(entry.id, entry.token);
		working = false;
		if (res === 'deleted') {
			removeFromShelf(entry.id);
			disarm();
			onDeleted(entry.id);
			return;
		}
		disarm();
		onDeleteFailed(res);
	}
</script>

<button
	type="button"
	onclick={handle}
	disabled={working}
	aria-label={armed ? `Confirm delete ${title}` : `Delete ${title}`}
	title={armed ? 'Sure?' : 'Delete'}
	class="shrink-0 transition disabled:opacity-40 {armed
		? 'px-2 py-1 text-xs font-semibold text-red-500 dark:text-red-400'
		: 'px-2 text-lg leading-none text-ink-soft hover:text-red-500 dark:hover:text-red-400'}"
>
	{armed ? 'Sure?' : '×'}
</button>
