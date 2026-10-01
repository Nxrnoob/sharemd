<script lang="ts">
	import { onMount } from 'svelte';
	import { themes, DEFAULT_THEME_ID, getTheme, applyTheme, applySessionTheme, buildThemedUrl } from '$lib/themes';
	import type { ThemeId } from '$lib/themes';

	let current = $state<string>(DEFAULT_THEME_ID);
	let open = $state(false);
	let root: HTMLElement | null = $state(null);
	let menu: HTMLElement | null = $state(null);
	let button: HTMLButtonElement | null = $state(null);
	let activeIndex = $state(0);

	const active = $derived(getTheme(current));

	onMount(() => {
		// The init script in app.html already set the theme pre-paint;
		// just sync the label with it (no visual flash).
		const saved = document.documentElement.dataset.theme;
		if (saved) {
			current = saved;
			activeIndex = Math.max(
				0,
				themes.findIndex((t) => t.id === saved)
			);
		}
	});

	function toggle() {
		open = !open;
		if (open) {
			activeIndex = Math.max(
				0,
				themes.findIndex((t) => t.id === current)
			);
			requestAnimationFrame(() => menu?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus());
		}
	}

	function close(refocus = false) {
		if (open) applySessionTheme(current);
		open = false;
		if (refocus) button?.focus();
	}

	function preview(id: string) {
		// Session-only paint: no storage write, committed on click.
		applySessionTheme(id);
	}

	function pick(id: string) {
		current = applyTheme(id).id;
		// Keep the URL in step so Copy Link shares exactly what is on screen.
		try {
			const here = window.location.pathname + window.location.search + window.location.hash;
			history.replaceState(null, '', buildThemedUrl(here, current as ThemeId));
		} catch {
			/* non-fatal: theme still applied + persisted */
		}
		close(true);
	}

	function onWindowClick(e: MouseEvent) {
		if (open && root && !root.contains(e.target as Node)) close();
	}

	function onMenuKey(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			close(true);
		} else if (e.key === 'ArrowDown') {
			e.preventDefault();
			activeIndex = (activeIndex + 1) % themes.length;
			menu?.querySelectorAll<HTMLElement>('[role="menuitemradio"]')[activeIndex]?.focus();
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			activeIndex = (activeIndex - 1 + themes.length) % themes.length;
			menu?.querySelectorAll<HTMLElement>('[role="menuitemradio"]')[activeIndex]?.focus();
		} else if (e.key === 'Home') {
			e.preventDefault();
			activeIndex = 0;
			menu?.querySelectorAll<HTMLElement>('[role="menuitemradio"]')[0]?.focus();
		} else if (e.key === 'End') {
			e.preventDefault();
			activeIndex = themes.length - 1;
			menu?.querySelectorAll<HTMLElement>('[role="menuitemradio"]')[activeIndex]?.focus();
		}
	}
</script>

<svelte:window onclick={onWindowClick} />

<div bind:this={root} class="relative">
	<button
		bind:this={button}
		type="button"
		onclick={toggle}
		onkeydown={(e) => {
			if (e.key === 'ArrowDown' && !open) {
				e.preventDefault();
				toggle();
			}
		}}
		aria-haspopup="menu"
		aria-expanded={open}
		aria-label="Editor theme, current: {active.label}"
		title="Editor theme"
		class="flex h-9 items-center gap-2 border border-line bg-surface px-2.5 text-[13px] font-medium transition hover:border-iris"
	>
		<span
			aria-hidden="true"
			class="swatch-split size-4 shrink-0 border"
			style="background: linear-gradient(90deg, {active.tokens.bg} 50%, {active.tokens.accent} 50%); border-color: {active.tokens.border}"
		></span>
		<span class="hidden max-w-28 truncate sm:inline">{active.label}</span>
		<span aria-hidden="true" class="text-[11px] opacity-60">▾</span>
	</button>

	{#if open}
		<div
			bind:this={menu}
			role="menu"
			tabindex="-1"
			aria-label="Editor theme"
			onkeydown={onMenuKey}
			onmouseleave={() => {
				if (open) applySessionTheme(current);
			}}
			class="absolute top-10 right-0 z-50 w-56 overflow-hidden border border-line bg-surface p-1 shadow-xl"
		>
			{#each themes as t, i (t.id)}
				<button
					type="button"
					role="menuitemradio"
					aria-checked={t.id === current}
					tabindex={i === activeIndex ? 0 : -1}
					onclick={() => pick(t.id)}
					onmouseenter={() => {
						activeIndex = i;
						preview(t.id);
					}}
					onfocus={() => preview(t.id)}
					class="flex w-full items-center gap-2.5 px-2.5 py-2 text-left text-[13px] transition {t.id === current
						? 'bg-iris/10 font-medium'
						: 'hover:bg-black/5 dark:hover:bg-white/5'}"
				>
					<span
						aria-hidden="true"
						class="swatch-split size-5 shrink-0 border"
						style="background: linear-gradient(90deg, {t.tokens.bg} 50%, {t.tokens.accent} 50%); border-color: {t.tokens.border}"
					></span>
					<span class="flex-1 truncate">{t.label}</span>
					{#if t.id === current}
						<span aria-hidden="true" class="text-iris">✓</span>
					{/if}
				</button>
			{/each}
		</div>
	{/if}
</div>
