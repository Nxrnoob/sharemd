<script lang="ts">
	/**
	 * A cat that meows by bobbing, drawn as vector geometry rather than traced
	 * from a photograph.
	 *
	 * Why drawn and not traced: the reference frames put the cat's fur and the
	 * wall behind it in the same brightness band, so neither flood fill nor
	 * thresholding can separate them — the silhouette is simply not recoverable
	 * from those pixels. Drawing it sidesteps the problem entirely and gets a
	 * clean result at any size, in one theme colour, with no image payload.
	 *
	 * The bob and the mouth flap share one period so they read as a single
	 * meow rather than two competing loops.
	 */
	interface Props {
		/** Rendered width; height follows the square viewBox. */
		size?: number;
		/** One full bob+meow cycle. */
		duration?: string;
		/** Freeze on the closed pose (also used for reduced motion). */
		paused?: boolean;
	}
	let { size = 64, duration = '0.9s', paused = false }: Props = $props();
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 100 100"
	fill="none"
	stroke="currentColor"
	stroke-width="4"
	stroke-linecap="round"
	stroke-linejoin="round"
	class="cat-meow {paused ? 'is-paused' : ''}"
	style:--meow-duration={duration}
	role="img"
	aria-label="Cat bobbing and meowing"
>
	<!--
		Whole-cat bob shares the mouth's period deliberately: two loops at
		different rates would drift visibly and stop reading as one meow.
	-->
	<g class="cat-bob">
		<!-- ears: bases tucked into the head so they never float -->
		<path d="M27 42 L29 16 L46 30" />
		<path d="M73 42 L71 16 L54 30" />

		<!-- head -->
		<ellipse cx="50" cy="57" rx="28" ry="25" />

		<!-- eyes -->
		<ellipse cx="39" cy="52" rx="3.4" ry="4.6" fill="currentColor" stroke="none" />
		<ellipse cx="61" cy="52" rx="3.4" ry="4.6" fill="currentColor" stroke="none" />

		<!-- nose -->
		<path d="M46.5 63 L53.5 63 L50 67.5 Z" fill="currentColor" stroke="none" />

		<!--
			Kept inside the jaw. Hinged at the nose so it opens downward; the
			closed pose collapses to a line rather than vanishing, so the muzzle
			still reads as a muzzle when the cat is not mid-meow.
		-->
		<ellipse class="cat-mouth" cx="50" cy="73" rx="7" ry="9" />

		<!-- whiskers -->
		<path d="M17 58 L31 61" stroke-width="3" />
		<path d="M83 58 L69 61" stroke-width="3" />
	</g>
</svg>

<style>
	/*
		Both animations run on the same duration and share their easing, so the
		head bob lands on the mouth opening instead of drifting against it.
	*/
	.cat-bob {
		transform-box: view-box;
		transform-origin: 50px 80px;
		animation: meow-bob var(--meow-duration) ease-in-out infinite;
	}

	@keyframes meow-bob {
		0%,
		100% {
			transform: translateY(0) rotate(-2.5deg);
		}
		45% {
			transform: translateY(-6px) rotate(2.5deg);
		}
	}

	/* Hinge the mouth at the nose so it opens downward like a real meow
	   instead of shrinking from its centre. */
	.cat-mouth {
		transform-box: fill-box;
		transform-origin: center top;
		animation: meow-mouth var(--meow-duration) ease-in-out infinite;
	}

	.cat-meow {
		overflow: visible;
	}

	.cat-meow.is-paused *,
	.cat-meow:is(.is-paused) .cat-mouth,
	.cat-meow.is-paused .cat-bob {
		animation-play-state: paused;
	}

	@keyframes meow-mouth {
		0%,
		100% {
			transform: scaleY(0.18);
		}
		45% {
			transform: scaleY(1);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		/* Hold a calm closed pose. Still present, just still. */
		.cat-mouth {
			animation: none;
			transform: scaleY(0.18);
		}
		.cat-bob {
			animation: none;
		}
	}
</style>