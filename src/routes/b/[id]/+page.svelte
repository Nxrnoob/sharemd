<script lang="ts">
	import { copyText } from '$lib/clipboard';
	import ThemePicker from '$lib/components/ThemePicker.svelte';
	import HowItWorksModal from '$lib/components/HowItWorksModal.svelte';
	import BackLink from '$lib/components/BackLink.svelte';
	import BackToTop from '$lib/components/BackToTop.svelte';

	let { data } = $props();

	/** This bundle's own path, used to mark where a reader arrived from. */
	const bundleHref = $derived(`/b/${data.slug ?? data.id}`);

	const isGone = $derived(data.gone === true);
	const isGated = $derived(!isGone && data.passwordRequired === true);

	let pwInput = $state('');
	let pwBusy = $state(false);
	let gateError = $state<string | null>(null);
	let copied = $state(false);

	const shareUrl = $derived(
		typeof location !== 'undefined'
			? new URL(`/b/${data.slug ?? data.id}`, location.origin).href
			: `/b/${data.slug ?? data.id}`
	);

	const live = $derived(data.members.filter((m) => !m.gone));
	const dead = $derived(data.members.filter((m) => m.gone));

	function timeAgo(ts: number): string {
		const s = Math.floor((Date.now() - ts) / 1000);
		if (s < 60) return 'just now';
		const m = Math.floor(s / 60);
		if (m < 60) return `${m} min ago`;
		const h = Math.floor(m / 60);
		if (h < 24) return `${h} hr ago`;
		const d = Math.floor(h / 24);
		if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`;
		return new Date(ts).toLocaleDateString();
	}

	async function copyLink() {
		if (await copyText(shareUrl)) {
			copied = true;
			setTimeout(() => (copied = false), 1600);
		}
	}

	function unlock() {
		if (!pwInput) {
			gateError = 'Enter the password.';
			return;
		}
		pwBusy = true;
		gateError = null;
		location.href = `/b/${data.slug ?? data.id}?pw=${encodeURIComponent(pwInput)}`;
	}
</script>

<svelte:head>
	<title>{data.title} · ShareMD</title>
	<meta name="description" content="A folder of {data.members.length} shared docs." />
	<meta property="og:title" content={data.title} />
	<meta property="og:description" content="A folder of {data.members.length} shared docs." />
</svelte:head>

{#if isGone}
	<main class="mx-auto grid w-full max-w-xl flex-1 place-items-center px-4 py-16 sm:px-6">
		<div class="rise w-full border border-line bg-surface p-6 text-center sm:p-8 dark:border-night-line dark:bg-night-surface">
			<p class="text-xs tracking-widest text-ink-soft uppercase dark:text-slate-500">Link done</p>
			<h1 class="font-display mt-3 text-2xl font-bold tracking-tight">
				This folder link expired or hit its view limit.
			</h1>
			<p class="mt-3 text-[15px] leading-relaxed text-ink-soft dark:text-slate-400">
				Ask the sender for a fresh one, or share a doc of your own.
			</p>
			<a
				href="/"
				class="btn-accent mt-6 inline-flex items-center justify-center px-6 py-2.5 text-[15px] font-semibold transition"
			>
				Share a new doc
			</a>
		</div>
	</main>
{:else if isGated}
	<main class="mx-auto grid w-full max-w-xl flex-1 place-items-center px-4 py-16 sm:px-6">
		<div class="rise w-full border border-line bg-surface p-6 sm:p-8 dark:border-night-line dark:bg-night-surface">
			<p class="text-xs tracking-widest text-ink-soft uppercase dark:text-slate-500">Protected folder</p>
			<h1 class="font-display mt-3 text-2xl font-bold tracking-tight">This folder is locked.</h1>
			<p class="mt-3 text-[15px] leading-relaxed text-ink-soft dark:text-slate-400">
				Type the password to open it. Ask the sender if you do not have it.
			</p>
			<form
				onsubmit={(e) => {
					e.preventDefault();
					unlock();
				}}
				class="mt-5"
			>
				<label class="block">
					<span class="mb-1.5 block text-sm font-medium">Password</span>
					<input
						type="password"
						bind:value={pwInput}
						oninput={() => (gateError = null)}
						placeholder="Folder password"
						autocomplete="off"
						class="w-full border border-line bg-paper px-3.5 py-2.5 text-[15px] placeholder:text-ink-soft/50 focus:border-iris dark:border-night-line dark:bg-night dark:placeholder:text-slate-600"
					/>
				</label>
				{#if gateError}
					<p role="alert" class="mt-2 text-sm font-medium text-red-600 dark:text-red-300">{gateError}</p>
				{/if}
				<button
					type="submit"
					disabled={pwBusy}
					class="btn-accent mt-4 inline-flex w-full items-center justify-center px-6 py-2.5 text-[15px] font-semibold transition"
				>
					Unlock
				</button>
			</form>
		</div>
	</main>
{:else}
	<main class="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6 sm:py-14">
		<div class="mb-6"><BackLink href="/library" label="Library" /></div>
		<p class="text-xs tracking-widest text-ink-soft uppercase dark:text-slate-500">
			Folder · {data.members.length}
			{data.members.length === 1 ? 'doc' : 'docs'}
		</p>
		<h1 class="font-display mt-2 text-3xl font-bold tracking-tight sm:text-4xl">{data.title}</h1>
		<p class="mt-2 text-sm text-ink-soft dark:text-slate-400">
			Shared {timeAgo(data.createdAt)} · {data.views}
			{data.views === 1 ? 'view' : 'views'}
		</p>

		<div class="mt-8 flex flex-col gap-3">
			{#each data.members as m (m.id)}
				{#if m.gone}
					<div
						class="flex items-baseline justify-between gap-4 border border-line px-4 py-3.5 opacity-55 dark:border-night-line"
					>
						<span class="text-[15px] line-through">{m.title}</span>
						<span class="shrink-0 text-xs tracking-wide text-ink-soft uppercase dark:text-slate-500">
							{m.gone === 'expired' ? 'expired' : 'view limit'}
						</span>
					</div>
				{:else}
					<a
						href="{m.href}?from={encodeURIComponent(bundleHref)}"
						class="group flex items-baseline justify-between gap-4 border border-line bg-surface px-4 py-3.5 transition hover:border-iris dark:border-night-line dark:bg-night-surface"
					>
						<span class="text-[15px] font-medium group-hover:underline">{m.title}</span>
						<span class="shrink-0 text-sm tabular-nums text-ink-soft dark:text-slate-400">
							{m.readMins} min
						</span>
					</a>
				{/if}
			{/each}
		</div>

		{#if live.length === 0 && dead.length > 0}
			<p class="mt-8 text-center text-[15px] text-ink-soft dark:text-slate-400">
				Every doc in this folder has since expired or hit its view limit.
			</p>
		{/if}

		<div class="mt-10 flex flex-wrap items-center justify-center gap-3 border-t border-line pt-8 dark:border-night-line">
			<button
				type="button"
				onclick={copyLink}
				class="btn-accent inline-flex items-center justify-center px-5 py-2.5 text-[15px] font-semibold transition"
			>
				{copied ? 'Copied' : 'Copy folder link'}
			</button>
			<a
				href="/"
				class="inline-flex items-center justify-center border border-line px-5 py-2.5 text-[15px] font-medium transition hover:border-iris dark:border-night-line"
			>
				Share your own
			</a>
		</div>
	</main>
{/if}

<HowItWorksModal />
<BackToTop />