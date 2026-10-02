<script lang="ts">
	import { page } from '$app/state';
</script>

<svelte:head>
	<title>Not found — ShareMD</title>
</svelte:head>

<main class="mx-auto grid w-full max-w-xl flex-1 place-items-center px-4 py-20 text-center sm:px-6">
	<div class="rise">
		<p class="text-xs tracking-widest text-iris uppercase">
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
			class="btn-accent mt-6 inline-flex items-center gap-2 px-5 py-2.5 font-medium transition"
		>
			Share a new doc →
		</a>
	</div>
</main>
