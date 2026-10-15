<script lang="ts">
	import type { Snippet } from 'svelte';
	import FileGlyph from './FileGlyph.svelte';
	import { ACTION_OVERLAY, FILE_BOX, FILE_META, FILE_NAME } from './fileSkin';

	/**
	 * A row in a management list: the same file surface as `DocTile`, laid out
	 * for a list instead of a grid.
	 *
	 * Why a row and not a tile here. A visitor tile carries one verb. An owner
	 * row has to carry a filing select plus four actions, and there is no
	 * honest way to fit that inside a 180px grid cell — that is precisely why
	 * every real file manager shows management work as a list. So the Library
	 * uses rows, and rows use this component, for docs and for shared folder
	 * links alike, which is also what kills the near-identical duplicated
	 * markup those two lists used to carry.
	 *
	 * What stays identical to the tile is the part that must not drift: the
	 * box, the glyph, and the name/meta type, all pulled from the same tokens.
	 * Only the layout differs.
	 *
	 * Density, and this is the whole answer to it. A visitor tile has one verb;
	 * an owner row has four, plus a control that has to stay put. So the row is
	 * split into a part that is always drawn and a part that is revealed:
	 *
	 *   - `control` (the filing select) is always drawn. It is the primary way
	 *     to file a doc, so it cannot be hover-gated — that would make filing
	 *     a mouse-only act.
	 *   - `actions` use `ACTION_OVERLAY`. At `lg` and up they are lifted out of
	 *     flow and laid over the name's tail, so four buttons cost a resting
	 *     row *zero* width and a long document title keeps the full pane. The
	 *     buttons stay in the DOM in reading order and stay tabbable, and
	 *     `group-focus-within` reveals them on arrival, so nothing is
	 *     hover-only. Below `lg` they drop back into the row (`contents`) and
	 *     are simply always drawn, because a touch screen has no hover.
	 *
	 * Reserving the width instead — the obvious alternative — was tried and is
	 * worse: at 1024px it left the document title 188px and truncated every
	 * name in the list.
	 */
	interface Props {
		label: string;
		/** Makes the name a real link to the thing it names. */
		href?: string;
		glyph?: 'doc' | 'folder' | 'link';
		meta: Snippet;
		control?: Snippet;
		actions?: Snippet;
		draggable?: boolean;
		ondragstart?: (e: DragEvent) => void;
		ondragend?: (e: DragEvent) => void;
		/** Dimmed while this row is the source of a drag in progress. */
		dimmed?: boolean;
		class?: string;
	}

	let {
		label,
		href,
		glyph = 'doc',
		meta,
		control,
		actions,
		draggable = false,
		ondragstart,
		ondragend,
		dimmed = false,
		class: cls = ''
	}: Props = $props();
</script>

<!-- The row is the drag source and the hover/focus group. Controls stay in the
     DOM when hidden, so Tab reaches them and focus-within lights them up. -->
<li
	class="group flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 transition sm:flex-nowrap {FILE_BOX} {dimmed
		? 'opacity-40'
		: ''} {cls}"
	{draggable}
	{ondragstart}
	{ondragend}
>
	<FileGlyph
		kind={glyph}
		class="size-6 shrink-0 text-ink-soft transition-colors group-hover:text-iris dark:text-slate-500"
	/>
	<div class="min-w-0 flex-1">
		{#if href}
			<a
				{href}
				class="block truncate {FILE_NAME} underline-offset-2 transition hover:text-iris hover:underline"
			>
				{label}
			</a>
		{:else}
			<span class="block truncate {FILE_NAME}">{label}</span>
		{/if}
		<span class="mt-0.5 block truncate {FILE_META}">{@render meta()}</span>
	</div>

	{#if control || actions}
		<!-- The trailing cluster. On a narrow window or a touch screen the actions
		     are permanently visible and are allowed to wrap under the row's own
		     line, right-aligned: a filing select plus four actions cannot share
		     343px, and forcing them onto one line is what pushed the row off the
		     screen. Only on a wide, hover-capable screen is the cluster a nowrap
		     right-hand column, because there the actions float above the name
		     instead and the select is all it has to hold. -->
		<div
			class="relative ml-auto flex w-full flex-wrap items-center justify-end gap-1.5 lg:w-auto lg:shrink-0 lg:flex-nowrap"
		>
			{#if control}{@render control()}{/if}
			{#if actions}
				<span
					class="flex items-center gap-1.5 {ACTION_OVERLAY} right-full mr-1.5"
				>{@render actions()}</span
				>
			{/if}
		</div>
	{/if}
</li>