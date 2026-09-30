<script lang="ts">
	import { page } from '$app/state';
</script>

<svelte:head>
	<title>Not found — ShareMD</title>
</svelte:head>

<main class="mx-auto grid w-full max-w-xl flex-1 place-items-center px-4 py-20 text-center sm:px-6">
	<div class="rise">
		<p class="font-mono text-xs tracking-widest text-iris uppercase dark:text-indigo-300">
			{page.status === 404 ? 'Nothing here' : `Error ${page.status}`}
		</p>
		<h1 class="font-display mt-3 text-4xl font-bold tracking-tight">This link did not pan out.</h1>
		<p class="mt-3 leading-relaxed text-ink-soft dark:text-slate-400">
			{#if page.status === 404}
				The doc may have never existed, or the link has a typo. Double-check the URL, or share a new doc.
			{:else}
				{page.error?.message ?? 'Something went wrong. Try again.'}
			{/if}
		</p>
		<a
			href="/"
			class="mt-6 inline-flex items-center gap-2 rounded-xl bg-iris px-5 py-2.5 font-medium text-white transition hover:bg-iris-deep dark:bg-indigo-500 dark:hover:bg-indigo-400"
		>
			Share a new doc →
		</a>
	</div>
</main>
