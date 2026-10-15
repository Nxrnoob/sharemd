<script lang="ts">
	import type { Snippet } from 'svelte';
	import FileGlyph from './FileGlyph.svelte';
	import { FILE_BOX, FILE_BOX_DASHED, FILE_META, FILE_NAME } from './fileSkin';

	/**
	 * A document tile: the icon-above-name surface that makes a grid of things
	 * read as a file manager rather than a list.
	 *
	 * One component, three jobs, because they are the same job at different
	 * levels of "can you do anything with this":
	 *
	 *   href set      → a real anchor, the document is readable
	 *   as="button"   → an affordance (adding a document)
	 *   plain         → a dead document: still shown, never clickable
	 *
	 * The element is chosen by prop rather than by the caller wrapping it, so
	 * the box, the glyph, the name and the meta line are guaranteed identical
	 * across all three. Anatomy, in order, every time:
	 *
	 *   glyph → name (held to two lines) → meta, pinned to the bottom with
	 *   `mt-auto` so the meta baselines line up across a row of unequal titles.
	 */
	interface Props {
		/** Set to render an anchor. Omit for a non-interactive surface. */
		href?: string;
		/** Render a real <button> instead of a div — for affordances. */
		as?: 'button';
		type?: 'button' | 'submit' | 'reset';
		label: string;
		glyph?: 'doc' | 'plus';
		meta?: Snippet;
		/** Dashed, unfilled: a thing that is not a document, or not reachable. */
		dashed?: boolean;
		/** Breaks the glyph's stroke too, for a member that can no longer be opened. */
		glyphDashed?: boolean;
		/** Dim the whole surface. Pairs with `dashed` for unavailable members. */
		faint?: boolean;
		weight?: 'medium' | 'semibold';
		strike?: boolean;
		/** Hover/focus tooltip — used when `meta` may be visually truncated. */
		tooltip?: string;
		onclick?: (e: MouseEvent) => void;
		'aria-expanded'?: boolean;
		'aria-controls'?: string;
		'aria-label'?: string;
		/** Bindable ref to the rendered root element, whatever it turns out to be. */
		el?: HTMLElement | null;
		class?: string;
	}

	let {
		href,
		as,
		type = 'button',
		label,
		glyph = 'doc',
		meta,
		dashed = false,
		glyphDashed = false,
		faint = false,
		weight = 'medium',
		strike = false,
		tooltip,
		onclick,
		'aria-expanded': ariaExpanded,
		'aria-controls': ariaControls,
		el = $bindable(null),
		class: cls = ''
	}: Props = $props();

	const box = $derived(
		[
			'h-full flex flex-col items-center px-3 py-4 text-center sm:px-4 sm:py-5',
			dashed ? FILE_BOX_DASHED : FILE_BOX,
			faint ? 'opacity-70' : '',
			cls
		]
			.filter(Boolean)
			.join(' ')
	);

	/**
	 * The glyph sits in a fixed-height slot. Drawn at its natural size the plus
	 * is optically smaller than the page glyph it replaces, which left the add
	 * tile a few pixels shorter than its neighbours; reserving the slot keeps
	 * every tile's rhythm identical no matter which glyph it carries.
	 */
	const glyphCls = $derived(
		'flex h-7 shrink-0 items-center justify-center sm:h-8 ' +
			(glyph === 'plus'
				? '[&_svg]:size-6 sm:[&_svg]:size-7'
				: '[&_svg]:size-7 sm:[&_svg]:size-8') +
			(glyphDashed ? ' [&_svg]:[stroke-dasharray:3_2.5]' : '') +
			' text-ink-soft transition-colors dark:text-slate-500'
	);
</script>

{#if href}
	<a bind:this={el} {href} title={tooltip} class="{box} group" {onclick}>
		<span class={glyphCls}>
			<FileGlyph kind={glyph} />
		</span>
		<span
			class="mt-2.5 line-clamp-2 min-h-9 w-full {FILE_NAME} {weight === 'semibold'
				? 'font-semibold tracking-tight'
				: 'underline-offset-2 group-hover:underline'} {strike
				? 'text-ink-soft line-through decoration-1 dark:text-slate-500'
				: ''}"
		>
			{label}
		</span>
		{#if meta}
			<span class="mt-auto block w-full min-w-0 truncate pt-1.5 text-center {FILE_META}">
				{@render meta()}
			</span>
		{/if}
	</a>
{:else if as === 'button'}
	<button bind:this={el} {type} {onclick} title={tooltip} aria-expanded={ariaExpanded} aria-controls={ariaControls} class="{box} group hover:text-iris">
		<span class="{glyphCls} group-hover:text-iris">
			<FileGlyph kind={glyph} />
		</span>
		<span class="mt-2.5 line-clamp-2 min-h-9 {FILE_NAME} font-semibold tracking-tight">
			{label}
		</span>
		{#if meta}
			<span class="mt-auto block w-full min-w-0 truncate pt-1.5 text-center {FILE_META}">
				{@render meta()}
			</span>
		{/if}
	</button>
{:else}
	<div bind:this={el} class={box}>
		<span class={glyphCls}>
			<FileGlyph kind={glyph} />
		</span>
		<span
			class="mt-2.5 line-clamp-2 min-h-9 w-full {FILE_NAME} {strike
				? 'text-ink-soft line-through decoration-1 dark:text-slate-500'
				: ''}"
		>
			{label}
		</span>
		{#if meta}
			<span class="mt-auto block w-full min-w-0 truncate pt-1.5 text-center {FILE_META}">
				{@render meta()}
			</span>
		{/if}
	</div>
{/if}