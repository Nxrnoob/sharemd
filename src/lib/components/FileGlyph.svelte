<script lang="ts">
	/**
	 * The only icons this app draws for files and places.
	 *
	 * Every document is markdown, so a grid of varied document icons would be
	 * fiction: one hairline page glyph carries the type. The other marks denote
	 * kinds of *thing* rather than variations of a document — a folder, a plus
	 * for an affordance — plus the three the sidebar needs to say "everything",
	 * "filed nowhere" and "this folder has been sent as a link".
	 *
	 * All of them inherit `currentColor` and share one stroke weight, so they
	 * sit with the type rather than floating above it. `class` is passed
	 * straight through — callers set size and colour, never the geometry.
	 */
	interface Props {
		kind?: 'doc' | 'folder' | 'plus' | 'all' | 'unfiled' | 'link';
		class?: string;
	}

	let { kind = 'doc', class: cls = '' }: Props = $props();
</script>

{#if kind === 'folder'}
	<svg
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="1.5"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
		class={cls}
	>
		<path
			d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"
		></path>
	</svg>
{:else if kind === 'plus'}
	<svg
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="1.5"
		stroke-linecap="round"
		aria-hidden="true"
		class={cls}
	>
		<path d="M12 5v14M5 12h14"></path>
	</svg>
{:else if kind === 'all'}
	<!-- Every item at once. Four squares, because a folder glyph here would say
	     "one folder" and this row is not a folder at all. -->
	<svg
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="1.5"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
		class={cls}
	>
		<rect x="3" y="3" width="7.5" height="7.5" rx="1.5"></rect>
		<rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"></rect>
		<rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"></rect>
		<rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"></rect>
	</svg>
{:else if kind === 'unfiled'}
	<!-- Filed nowhere: a tray with no lid on it, so it reads as "in" rather
	     than as another folder. -->
	<svg
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="1.5"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
		class={cls}
	>
		<path d="M6.2 3.5h11.6a2 2 0 0 1 1.93 1.47L21.5 11v5a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2v-5L4.27 4.97A2 2 0 0 1 6.2 3.5Z"
		></path>
		<path d="M2.6 12.6h4.3l1.4 2.8h7.4l1.4-2.8h4.4"></path>
	</svg>
{:else if kind === 'link'}
	<!-- A folder link: two interlocking arcs. Deliberately not the folder
	     glyph — a shared folder and the folder it came from must not look
	     like two of the same thing stacked on each other. -->
	<svg
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="1.5"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
		class={cls}
	>
		<path d="M10.4 13.6a4.2 4.2 0 0 0 5.94 0l2.9-2.9a4.2 4.2 0 0 0-5.94-5.94l-1.2 1.2"></path>
		<path
			d="M13.6 10.4a4.2 4.2 0 0 0-5.94 0l-2.9 2.9a4.2 4.2 0 0 0 5.94 5.94l1.2-1.2"
		></path>
	</svg>
{:else}
	<svg
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="1.5"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
		class={cls}
	>
		<path d="M14 2.5H7A1.5 1.5 0 0 0 5.5 4v16A1.5 1.5 0 0 0 7 21.5h10a1.5 1.5 0 0 0 1.5-1.5V7z"
		></path>
		<path d="M14 2.5V7h4.5"></path>
		<path d="M8.75 12.5h6.5M8.75 16h4.5"></path>
	</svg>
{/if}