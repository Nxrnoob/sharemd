<script lang="ts">
	import type { Snippet } from 'svelte';
	import FileGlyph from './FileGlyph.svelte';
	import { EYEBROW, RULE, SUBTLE } from './fileSkin';

	/**
	 * A container header: the thing that *contains* files, never dressed as one
	 * of them.
	 *
	 * The rule this page family follows is that contents are boxed and
	 * containers are typographic. So this is deliberately unboxed — a glyph, a
	 * kicker, a display title, a quiet meta line — closed by a single hairline.
	 * Giving the header its own panel would put it at the same visual weight as
	 * its own members, which is exactly the confusion the rule exists to prevent.
	 *
	 * The title is an `<h1>`; callers that need the page heading to carry an id
	 * (dialog labels, aria) can pass one.
	 */
	interface Props {
		eyebrow: string;
		title: string;
		meta?: Snippet;
		glyph?: 'folder' | 'doc';
		id?: string;
	}

	let { eyebrow, title, meta, glyph = 'folder', id }: Props = $props();
</script>

<header class="flex items-start gap-4 border-b {RULE} pb-6">
	<FileGlyph kind={glyph} class="mt-1.5 size-8 shrink-0 text-ink-soft dark:text-slate-500" />
	<div class="min-w-0 flex-1">
		<p class={EYEBROW}>{eyebrow}</p>
		<h1 {id} class="font-display mt-2 text-3xl font-bold tracking-tight break-words sm:text-4xl">
			{title}
		</h1>
		{#if meta}
			<p class="mt-2 text-sm {SUBTLE}">{@render meta()}</p>
		{/if}
	</div>
</header>