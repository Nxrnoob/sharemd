<script lang="ts">
	import { RULE } from './fileSkin';

	/**
	 * The tally under a pane's contents, the way a file manager keeps one along
	 * the bottom of its window.
	 *
	 * It lives here rather than in either page so the two cannot disagree about
	 * where counts belong. Note what is deliberately *not* here: this is where
	 * numbers go, never in the pane header — a header that also counts stops
	 * being the container's name and starts competing with what it holds.
	 */
	interface Props {
		text: string;
		class?: string;
	}

	let { text, class: cls = '' }: Props = $props();
</script>

<p
	class="mt-6 border-t {RULE} pt-2.5 font-mono text-[11px] tracking-wide text-ink-soft dark:text-slate-500 {cls}"
>
	{text}
</p>