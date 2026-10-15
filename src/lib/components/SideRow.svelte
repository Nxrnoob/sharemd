<script lang="ts">
	import type { Snippet } from 'svelte';
	import FileGlyph from './FileGlyph.svelte';
	import { ACTION_OVERLAY, RULE } from './fileSkin';

	/**
	 * One row of a file manager's sidebar.
	 *
	 * This is the third thing that draws "a glyph, a name, and a tally" and the
	 * reason it is a component: the Library's rail had grown three hand-written
	 * versions of the same row — the two filters, the folders, and the shared
	 * links — each with its own copy of the class strings. They drifted inside a
	 * single file, and a folder name ended up truncated at rest by action buttons
	 * that were not even visible. One row, one set of strings.
	 *
	 * A sidebar row is *navigation*, not content, so unlike `DocTile` and
	 * `FileRow` it is never boxed: the container is typographic, and a sidebar is
	 * a container. Selection is a filled surface plus an accent glyph rather than
	 * a left border, because an extra rule would have to reserve width and would
	 * reflow every row when it appeared.
	 *
	 * Density follows the same rule as the list row, for the same reason. The
	 * count is what a resting row shows, so revealed actions overlay it rather
	 * than squeezing the name out of a 320px column: the count fades and the
	 * actions take its place, which is what Finder does. Below `lg` the overlay
	 * becomes `contents` and everything is simply drawn. Nothing is hover-only —
	 * the actions stay in the DOM, in tab order, and `group-focus-within` brings
	 * them in on arrival.
	 */
	interface Props {
		label: string;
		glyph?: 'all' | 'unfiled' | 'folder' | 'link';
		/** The trailing tally. Fades out while this row's actions are showing. */
		count?: number | null;
		/** Renders an anchor (something you can open) instead of a filter button. */
		href?: string;
		active?: boolean;
		/** Overrides the accessible name when `label` alone is ambiguous. */
		ariaLabel?: string;
		title?: string;
		onclick?: () => void;
		actions?: Snippet;
		/** Drag-and-drop filing: highlight while a doc hovers this row. */
		dropping?: boolean;
		ondragover?: (e: DragEvent) => void;
		ondragleave?: (e: DragEvent) => void;
		ondrop?: (e: DragEvent) => void;
		/** Nested under the row above, hung off a hairline spine. */
		child?: boolean;
		class?: string;
	}

	let {
		label,
		glyph = 'folder',
		count = null,
		href,
		active = false,
		ariaLabel,
		title,
		onclick,
		actions,
		dropping = false,
		ondragover,
		ondragleave,
		ondrop,
		child = false,
		class: cls = ''
	}: Props = $props();

	const base =
		'flex w-full min-w-0 items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[13px] transition';

	const surface = $derived(
		active
			? 'bg-surface text-ink dark:bg-night-surface dark:text-white'
			: 'text-ink-soft hover:bg-surface hover:text-ink dark:text-slate-400 dark:hover:bg-night-surface dark:hover:text-white'
	);

	const glyphCls = $derived(
		'size-4 shrink-0 transition-colors ' + (active ? 'text-iris' : 'group-hover:text-iris')
	);

	/**
	 * The wrapper is a wrapping flex row so that below `lg` — where the actions
	 * are permanently visible and `ACTION_OVERLAY` resolves to `contents` — they
	 * drop onto a second, right-aligned line instead of squeezing the name out
	 * of a 320px column. At `lg` the only in-flow child is the row itself and the
	 * actions float, so the wrap never triggers.
	 */
	const wrap = $derived(
		'group relative flex flex-wrap items-center justify-end gap-x-1 ' +
			(child ? 'ml-4 border-l pl-2 ' + RULE + ' ' : '') +
			cls
	);
</script>

{#snippet row()}
	<FileGlyph kind={glyph} class={glyphCls} />
	<!-- A rail row is only 320px, and three or four revealed actions are about
	     half of that. So the name yields exactly that much while they are out.
	     Because the name is one truncated line this only moves the ellipsis —
	     nothing re-wraps and no other row moves, which is what reserving the
	     width permanently would have cost. A link row, which has no count to
	     sit between them and its actions, needs it most. -->
	<span
		class="min-w-0 flex-1 truncate pr-4 transition-[padding] duration-150 {actions
			? 'group-hover:pr-[9.75rem] group-focus-within:pr-[9.75rem]'
			: ''}">{label}</span
	>
	{#if count !== null}
		<span
			class="shrink-0 tabular-nums opacity-60 transition-opacity duration-150 group-hover:opacity-0 group-focus-within:opacity-0"
		>
			{count}
		</span>
	{/if}
{/snippet}

<!-- `group` is what the reveal and the glyph tint key off, and it wraps the
     whole row so the drop chrome and the actions stay one target. `role=none`
     because the drag handlers live on a wrapper, not on anything with meaning.

     The actions are deliberately a *sibling* of the row, never a child: a
     <button> inside the row's own <button> (or a nested control inside its <a>)
     is invalid, and worse, every action click then bubbles to the row and
     fires it too — "Rename" would also file you into that folder. -->
<div class={wrap} {ondragover} {ondragleave} {ondrop} role="none">
	{#if href}
		<a
			{href}
			{title}
			aria-label={ariaLabel}
			aria-current={active ? 'page' : undefined}
			class="{base} {surface}"
		>
			{@render row()}
		</a>
	{:else}
		<button
			type="button"
			{onclick}
			{title}
			aria-label={ariaLabel}
			aria-current={active ? 'page' : undefined}
			class="{base} {surface}"
		>
			{@render row()}
		</button>
	{/if}

	{#if actions}
		<!-- Anchored to the row's trailing edge, directly over the count it
		     replaces. No backdrop is needed: the count fades out of the way
		     rather than showing through the buttons. -->
		<span class="right-0 flex items-center gap-1 {ACTION_OVERLAY}">{@render actions()}</span>
	{/if}

	{#if dropping}
		<!-- An accent ring rather than a border swap: the row must not resize
		     when a doc passes over it, or the rail jitters under the cursor. -->
		<div class="pointer-events-none absolute inset-0 rounded-sm ring-1 ring-iris"></div>
	{/if}
</div>
