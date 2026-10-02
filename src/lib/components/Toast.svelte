<script lang="ts">
	interface Props {
		message: string | null;
		kind?: 'ok' | 'error';
		link?: string | null;
	}

	let { message, kind = 'ok', link = null }: Props = $props();
</script>

{#if message}
	<div
		role={kind === 'error' ? 'alert' : 'status'}
		class="toast-in fixed bottom-5 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 items-center gap-3 border px-4 py-3 shadow-xl {kind === 'error'
			? 'border-red-300 bg-white text-red-900 dark:border-red-900 dark:bg-[#2a1420] dark:text-red-100'
			: 'border-line bg-ink text-white dark:border-night-line dark:bg-surface dark:text-ink'}"
	>
		<span
			class="grid size-7 shrink-0 place-items-center rounded-none text-sm {kind === 'error'
				? 'bg-red-100 dark:bg-red-950'
				: 'btn-accent'}"
			aria-hidden="true"
		>
			{kind === 'error' ? '!' : '✓'}
		</span>
		<p class="min-w-0 flex-1 text-sm leading-snug">{message}</p>
		{#if link}
			<a
				href={link}
				class="shrink-0 bg-white/15 px-2.5 py-1 text-xs underline-offset-2 hover:underline dark:bg-ink/10"
				>Open</a
			>
		{/if}
	</div>
{/if}

