<script lang="ts">
	import PopCat from './PopCat.svelte';

	/**
	 * DVD-screensaver cat.
	 *
	 * While `active`, the outline cat drifts on a fixed diagonal at a constant
	 * speed and turns at every edge, so it never leaves the viewport. Landing
	 * both edges in the same frame — a corner — tints the cat with the accent
	 * for a moment, because that is the whole point of the format.
	 *
	 * Reuses the art the drag ghost uses, still on its own autoplay clock, so
	 * the mouth keeps bobbing while it travels.
	 */
	interface Props {
		active?: boolean;
	}
	let { active = false }: Props = $props();

	/** Bigger than the drag ghost's 96 so it still reads over a modal. */
	const SIZE = 112;
	/** Viewport px per second. Rotation preserves length, so this never drifts. */
	const SPEED = 200;
	/** How long the accent tint survives a corner hit. */
	const CORNER_MS = 900;
	/**
	 * Rotation applied to the heading on every bounce, ~6.3 degrees.
	 *
	 * A perfectly constant diagonal is a trap here: a corner needs the x and y
	 * crossing distances to be exactly commensurate, which on a 620x420 viewport
	 * means 127 crossings (~4.6 min) and on a 1512x982 laptop ~15 min. Measured
	 * on this viewport, a constant 45 degrees produced zero corners in 26s.
	 * Nudging the heading keeps the straight legs and edge bounces that make the
	 * format read as a screensaver while letting corners actually arrive.
	 */
	const NUDGE = 0.11;
	/**
	 * Two edge hits this close together in time count as a corner, rather than
	 * demanding both walls in the same frame — a demand the drifting heading
	 * would still rarely meet.
	 */
	const CORNER_WINDOW = 0.2;

	let x = $state(0);
	let y = $state(0);
	let vw = $state(0);
	let vh = $state(0);
	let running = $state(false);
	let cornered = $state(false);

	let rafId = 0;
	let last = 0;
	let elapsed = 0;
	let vx = 0;
	let vy = 0;
	let nudgeSign = 1;
	let lastEdgeX = -Infinity;
	let lastEdgeY = -Infinity;
	let cornerArmed = true;
	let cornerTimer = 0;
	let hits = 0;

	/** Rotate the heading by `a` radians. Length is preserved, so speed is too. */
	function rotate(a: number) {
		const c = Math.cos(a);
		const s = Math.sin(a);
		const nvx = vx * c - vy * s;
		const nvy = vx * s + vy * c;
		vx = nvx;
		vy = nvy;
	}

	function celebrate() {
		hits += 1;
		cornered = true;
		cornerArmed = false;
		clearTimeout(cornerTimer);
		cornerTimer = window.setTimeout(() => {
			cornered = false;
			cornerArmed = true;
		}, CORNER_MS);
	}

	function step(now: number) {
		// Clamped so returning to a backgrounded tab resumes from where the cat
		// paused rather than teleporting it across the viewport on the one huge
		// delta frame.
		const dt = Math.min((now - last) / 1000, 0.05);
		last = now;
		elapsed += dt;

		x += vx * dt;
		y += vy * dt;

		let hitX = false;
		let hitY = false;

		if (x <= 0) {
			x = 0;
			vx = Math.abs(vx);
			hitX = true;
		} else if (x + SIZE >= vw) {
			x = vw - SIZE;
			vx = -Math.abs(vx);
			hitX = true;
		}

		if (y <= 0) {
			y = 0;
			vy = Math.abs(vy);
			hitY = true;
		} else if (y + SIZE >= vh) {
			y = vh - SIZE;
			vy = -Math.abs(vy);
			hitY = true;
		}

		if (hitX) lastEdgeX = elapsed;
		if (hitY) lastEdgeY = elapsed;

		// One nudge per frame that touched a wall, alternating direction, so the
		// heading wanders without accumulating a bias either way.
		if (hitX || hitY) {
			rotate(nudgeSign * NUDGE);
			nudgeSign = -nudgeSign;
		}

		if (cornerArmed && Math.abs(lastEdgeX - lastEdgeY) <= CORNER_WINDOW) celebrate();

		rafId = requestAnimationFrame(step);
	}

	$effect(() => {
		if (!active) return;

		// Motion of this speed and scale is exactly what reduced-motion asks us
		// not to do, so the egg simply stays unhatched for those visitors.
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

		vw = window.innerWidth;
		vh = window.innerHeight;
		// Clear of both corners on the way up, heading down-right, so the opening
		// frames are a travel leg rather than an immediate bounce.
		x = vw * 0.2;
		y = vh * 0.25;
		vx = SPEED / Math.SQRT2;
		vy = SPEED / Math.SQRT2;
		last = performance.now();
		running = true;
		rafId = requestAnimationFrame(step);

		const onResize = () => {
			vw = window.innerWidth;
			vh = window.innerHeight;
			// Pull it back in if the window shrank underneath it.
			x = Math.min(Math.max(x, 0), Math.max(0, vw - SIZE));
			y = Math.min(Math.max(y, 0), Math.max(0, vh - SIZE));
		};
		window.addEventListener('resize', onResize);

		return () => {
			window.removeEventListener('resize', onResize);
			if (rafId) cancelAnimationFrame(rafId);
			rafId = 0;
			clearTimeout(cornerTimer);
			running = false;
			cornered = false;
		};
	});
</script>

{#if running}
	<div class="pointer-events-none fixed inset-0 z-[60] overflow-hidden" aria-hidden="true" inert>
		<div
			class="absolute top-0 left-0 will-change-transform transition-colors duration-500 {cornered
				? 'text-iris'
				: 'text-white/90'} drop-shadow-[0_6px_18px_rgba(0,0,0,0.5)]"
			style:transform="translate3d({x}px, {y}px, 0)"
		>
			<PopCat size={SIZE} strokeWidth={16} autoPlay interval={250} sound={false} />
		</div>
	</div>
{/if}
