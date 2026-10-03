/**
 * Quiet Signals — per-document generative cover art.
 *
 * A pure, isomorphic function from seed to standalone SVG. No DOM, no
 * canvas, no p5, no Math.random: a FNV-1a string hash feeds mulberry32,
 * which seeds two 1-D value-noise lattices; layered horizontal contour
 * lines, one carrier trace, scanline rules, and sample markers are then
 * serialized as geometry. Same seed in, identical string out — on the
 * server and in the browser. See art/quiet-signals.md for the movement.
 *
 * NOTE ON LOCATION: the implementation lives in `$lib/cover.ts` (not
 * `$lib/server/`) because client surfaces must call it at runtime to
 * re-theme via the palette param, and SvelteKit forbids importing
 * `$lib/server/*` from client code. `$lib/server/cover.ts` re-exports
 * this module for server-side bundles.
 *
 * Budget: element counts and sample density scale with the canvas and
 * are capped, so a 1200x630 OG render stays far under 200KB and a
 * thumbnail renders for almost nothing. No text, no external refs —
 * pure geometry; words are overlaid in HTML by the caller.
 */

export interface CoverPalette {
	bg: string;
	ink: string;
	accent: string;
}

export interface CoverOptions {
	width?: number;
	height?: number;
	palette?: CoverPalette;
}

/**
 * Fixed dark palette for contexts without theme information (OG
 * rasterization, SSR first paint): near-black ground, off-white ink,
 * one restrained indigo accent.
 */
export const DEFAULT_COVER_PALETTE: CoverPalette = {
	bg: '#0a0a0c',
	ink: '#e8e6df',
	accent: '#7c86c7'
};

/** FNV-1a 32-bit: doc id / pathname → stable unsigned seed. */
export function hashSeed(input: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < input.length; i++) {
		h ^= input.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}

/** mulberry32: tiny, fast, fully deterministic PRNG over a 32-bit seed. */
function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * 1-D value noise: smoothstep interpolation over a seeded lattice.
 * The lattice is drawn from the PRNG first so every later decision
 * consumes the stream in a fixed, reproducible order.
 */
function makeValueNoise(rand: () => number, size = 256): (x: number) => number {
	const lattice = new Float64Array(size);
	for (let i = 0; i < size; i++) lattice[i] = rand();
	return (x: number) => {
		const xi = Math.floor(x);
		const t = x - xi;
		const s = t * t * (3 - 2 * t);
		const i0 = (((xi % size) + size) % size + size) % size;
		const i1 = (i0 + 1) % size;
		return lattice[i0] + (lattice[i1] - lattice[i0]) * s;
	};
}

/** Three octaves, normalized back into roughly [0, 1]. */
function fbm(noise: (x: number) => number, x: number): number {
	return (noise(x) + 0.5 * noise(x * 2 + 31.7) + 0.25 * noise(x * 4 + 87.3)) / 1.75;
}

/** Round to 2 decimals and stringify without trailing zeros. */
function n(v: number): string {
	return String(Math.round(v * 100) / 100);
}

function clampInt(v: number | undefined, fallback: number, min: number, max: number): number {
	const num = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : fallback;
	return Math.min(max, Math.max(min, num));
}

const HEX = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/** Accept only plain hex colors — the output is injected via {@html}. */
function normalizePalette(p?: CoverPalette): CoverPalette {
	const pick = (v: string | undefined, fallback: string) =>
		typeof v === 'string' && HEX.test(v.trim()) ? v.trim() : fallback;
	return {
		bg: pick(p?.bg, DEFAULT_COVER_PALETTE.bg),
		ink: pick(p?.ink, DEFAULT_COVER_PALETTE.ink),
		accent: pick(p?.accent, DEFAULT_COVER_PALETTE.accent)
	};
}

interface WaveArgs {
	noise: (x: number) => number;
	base: number;
	amp: number;
	cycles: number;
	phase: number;
	samples: number;
	width: number;
	height: number;
	stroke: string;
	opacity: number;
	sw: number;
}

/** One horizontal trace: a polyline sampled from fbm across the width. */
function wavePath(a: WaveArgs): string {
	let d = '';
	for (let s = 0; s <= a.samples; s++) {
		const x = (s / a.samples) * a.width;
		const v = fbm(a.noise, (s / a.samples) * a.cycles + a.phase);
		let y = a.base + (v - 0.5) * 2 * a.amp;
		if (y < 1) y = 1;
		else if (y > a.height - 1) y = a.height - 1;
		d += (s === 0 ? 'M' : 'L') + n(x) + ' ' + n(y);
	}
	return `<path d="${d}" fill="none" stroke="${a.stroke}" stroke-opacity="${n(a.opacity)}" stroke-width="${a.sw}" vector-effect="non-scaling-stroke"/>`;
}

/**
 * Render the Quiet Signals field for a seed.
 *
 * @param seed  unsigned 32-bit seed (use hashSeed(id) for documents)
 * @param opts  canvas size (default 1200x630, the OG frame) and palette
 * @returns a standalone, self-contained SVG string
 */
export function renderCoverSVG(seed: number, opts: CoverOptions = {}): string {
	const width = clampInt(opts.width, 1200, 32, 4096);
	const height = clampInt(opts.height, 630, 32, 4096);
	const { bg, ink, accent } = normalizePalette(opts.palette);

	// Fixed consumption order: two lattices, then every compositional
	// decision below — this is what makes same-seed output byte-identical.
	const rand = mulberry32(seed >>> 0);
	const wave = makeValueNoise(rand);
	const drift = makeValueNoise(rand);

	const parts: string[] = [];
	parts.push(
		`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">`,
		`<rect width="${width}" height="${height}" fill="${bg}"/>`
	);

	// Scanline texture: hairline rules every ~height/16, one path, 5% ink.
	const gap = Math.max(7, Math.round(height / 16));
	let scan = '';
	for (let y = gap; y < height; y += gap) scan += `M0 ${n(y)}h${width}`;
	parts.push(
		`<path d="${scan}" fill="none" stroke="${ink}" stroke-opacity="0.05" stroke-width="1" vector-effect="non-scaling-stroke"/>`
	);

	// Contour stack: most lines nearly flat, a few wavier; ~1 in 7 accent.
	const lineCount = clampInt(Math.round(height / 10), 12, 6, 48);
	const samples = clampInt(Math.round(width / 14), 40, 20, 90);
	for (let i = 0; i < lineCount; i++) {
		const row = (i + 0.5) / lineCount;
		const base = row * height + (drift(i * 0.83 + 0.37) - 0.5) * ((height / lineCount) * 0.9);
		const accentLine = rand() < 1 / 7;
		const amp = height * 0.13 * (0.15 + 0.85 * rand() * rand());
		const cycles = 1.2 + rand() * 2.8;
		const phase = rand() * 64;
		const opacity = accentLine ? 0.28 + rand() * 0.18 : 0.08 + rand() * 0.16;
		parts.push(
			wavePath({
				noise: wave,
				base,
				amp,
				cycles,
				phase,
				samples,
				width,
				height,
				stroke: accentLine ? accent : ink,
				opacity,
				sw: 1
			})
		);
	}

	// Carrier: the document's signature trace — widest swing, half strength.
	const carrierBase = height * (0.3 + rand() * 0.4);
	const carrierAmp = height * 0.18;
	const carrierCycles = 0.9 + rand() * 1.5;
	const carrierPhase = rand() * 64;
	parts.push(
		wavePath({
			noise: wave,
			base: carrierBase,
			amp: carrierAmp,
			cycles: carrierCycles,
			phase: carrierPhase,
			samples,
			width,
			height,
			stroke: accent,
			opacity: 0.5,
			sw: 1.5
		})
	);

	// Sample markers: small sharp squares pinned to points on the carrier.
	const markerCount = 4 + Math.floor(rand() * 6);
	for (let m = 0; m < markerCount; m++) {
		const s = Math.floor(((m + rand()) / markerCount) * samples);
		const x = (s / samples) * width;
		const u = (s / samples) * carrierCycles + carrierPhase;
		const y = carrierBase + (fbm(wave, u) - 0.5) * 2 * carrierAmp;
		parts.push(
			`<rect x="${n(x - 1.5)}" y="${n(y - 1.5)}" width="3" height="3" fill="${accent}" fill-opacity="0.7"/>`
		);
	}

	parts.push('</svg>');
	return parts.join('');
}
