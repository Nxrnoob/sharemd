/**
 * Letter Field — ghost letters of what the user actually types.
 *
 * A dependency-free canvas-2D sketch factory. Each planted character
 * becomes one faint glyph near the editor; glyphs fade over seconds and
 * an idle page returns to empty. See art/letter-field.md for the movement.
 *
 * Layering contract (HARD-WON RULE): `body` paints opaque
 * `background: var(--color-paper)`, so the canvas MUST composite above it
 * as a direct <body> child with LETTER_FIELD_CANVAS_CSS below, while the
 * app root carries `relative z-10` and paints above the canvas.
 * The canvas itself is fully transparent — it is cleared, never filled —
 * so the page ground shows through everywhere no glyph sits.
 *
 * Randomness: one seeded mulberry32 stream drives glyph jitter, rotation,
 * size, lifespan and the rare accent. Same seed, same sequence; the field
 * is a texture of the input, never a surprise generator.
 */

/**
 * Inline style for the field canvas. Kept as a literal (not Tailwind
 * classes) because this module may run before utility CSS is scanned,
 * and the layering rule must hold unconditionally.
 *
 * @type {string}
 */
export const LETTER_FIELD_CANVAS_CSS =
	'position:fixed;inset:0;z-index:0;pointer-events:none;display:block;width:100vw;height:100vh;';

/**
 * @typedef {Object} LetterFieldOptions
 * @property {number} [seed] Fixed seed for the jitter stream.
 * @property {number} [maxGlyphs] Total living glyphs kept (oldest drop first).
 * @property {number} [burstCap] Characters accepted per plant() call.
 * @property {boolean} [reducedMotion] Start in reduced-motion static mode.
 */

/**
 * @typedef {Object} LetterFieldHandle
 * @property {(text: string) => void} plant Plant literal characters as glyphs.
 * @property {() => void} retint Re-read theme colors; repaints when static.
 * @property {() => void} resize Refit the bitmap to the viewport.
 * @property {(paused: boolean) => void} setPaused Freeze/resume for tab-hidden.
 * @property {(on: boolean) => void} setReducedMotion Switch motion modes live.
 * @property {() => void} destroy Stop the loop, clear, remove the canvas.
 */

/**
 * @typedef {Object} Glyph
 * @property {string} ch
 * @property {number} x
 * @property {number} y
 * @property {number} size
 * @property {number} rot
 * @property {number} born
 * @property {number} life
 * @property {number} alpha
 * @property {boolean} accent
 */

/**
 * mulberry32: tiny, fully deterministic PRNG over a 32-bit seed.
 *
 * @param {number} seed
 * @returns {() => number} Floats in [0, 1).
 */
function mulberry32(seed) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * Accept only plain hex theme colors.
 *
 * @param {string} value Raw CSS variable value.
 * @param {{ r: number, g: number, b: number }} fallback
 * @returns {{ r: number, g: number, b: number }}
 */
function parseHexColor(value, fallback) {
	const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(value.trim().toLowerCase());
	if (!m) return fallback;
	let hex = m[1];
	if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
	const num = parseInt(hex, 16);
	return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

/**
 * @param {number} v
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(v, min, max) {
	return Math.min(max, Math.max(min, v));
}

/**
 * Create the letter field on a canvas the caller owns (a direct <body>
 * child styled with LETTER_FIELD_CANVAS_CSS). Client-only: call from
 * onMount; the module itself touches no DOM at import time.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {LetterFieldOptions} [options]
 * @returns {LetterFieldHandle}
 */
export function createLetterField(canvas, options = {}) {
	const rand = mulberry32(options.seed ?? 0x1e77f1e1);
	const coarse =
		typeof window !== 'undefined' &&
		(window.matchMedia('(pointer: coarse)').matches ||
			Math.min(window.innerWidth, window.innerHeight) < 560);
	const maxGlyphs = options.maxGlyphs ?? (coarse ? 28 : 64);
	const burstCap = options.burstCap ?? (coarse ? 6 : 12);
	let reduced =
		options.reducedMotion ??
		(typeof window !== 'undefined' &&
			window.matchMedia('(prefers-reduced-motion: reduce)').matches);

	const ctxOrNull = canvas.getContext('2d');
	if (!ctxOrNull) {
		const noop = () => {};
		return {
			plant: noop,
			retint: noop,
			resize: noop,
			setPaused: noop,
			setReducedMotion: noop,
			destroy: noop
		};
	}
	// checkJs cannot carry early-return narrowing into the closures below,
	// so capture the live context under an explicit non-null type.
	/** @type {CanvasRenderingContext2D} */
	const ctx = ctxOrNull;

	/** @type {{ r: number, g: number, b: number }} */
	let ink = { r: 245, g: 245, b: 245 };
	/** @type {{ r: number, g: number, b: number }} */
	let accent = { r: 255, g: 255, b: 255 };

	function readThemeColors() {
		try {
			const css = window.getComputedStyle(document.documentElement);
			ink = parseHexColor(css.getPropertyValue('--color-ink'), ink);
			accent = parseHexColor(css.getPropertyValue('--color-iris'), accent);
		} catch {
			/* keep last known palette; the field stays up regardless */
		}
	}

	/** @type {Glyph[]} */
	let glyphs = [];
	let raf = 0;
	let paused = false;
	let hiddenAt = 0;

	/**
	 * Sample a point in a halo around the editor and push it clear of the
	 * opaque panel, so every glyph lands on visible page ground instead of
	 * hiding under the machine (or over the real text being typed).
	 *
	 * @returns {{ x: number, y: number }}
	 */
	function placeNearEditor() {
		const vw = window.innerWidth;
		const vh = window.innerHeight;
		const ta = document.querySelector('textarea');
		const panel = document.querySelector('.paper-stack');
		const taRect = ta instanceof HTMLTextAreaElement ? ta.getBoundingClientRect() : null;
		const panelRect = panel instanceof Element ? panel.getBoundingClientRect() : taRect;
		if (!taRect || taRect.width < 4 || taRect.height < 4) {
			return {
				x: 16 + rand() * Math.max(32, vw - 32),
				y: 16 + rand() * Math.max(32, vh - 32)
			};
		}
		const cx = taRect.left + taRect.width / 2;
		const cy = taRect.top + taRect.height / 2;
		const angle = rand() * Math.PI * 2;
		const radius = 90 + rand() * 230;
		let x = cx + Math.cos(angle) * radius * 1.25 + (rand() - 0.5) * 70;
		let y = cy + Math.sin(angle) * radius * 0.85 + (rand() - 0.5) * 70;
		x = clamp(x, 14, Math.max(28, vw - 14));
		y = clamp(y, 14, Math.max(28, vh - 14));
		if (panelRect && panelRect.width > 4 && panelRect.height > 4) {
			const m = 16;
			const inside =
				x > panelRect.left - m &&
				x < panelRect.right + m &&
				y > panelRect.top - m &&
				y < panelRect.bottom + m;
			if (inside) {
				const dl = Math.abs(x - (panelRect.left - m));
				const dr = Math.abs(panelRect.right + m - x);
				const dt = Math.abs(y - (panelRect.top - m));
				const db = Math.abs(panelRect.bottom + m - y);
				const pick = Math.min(dl, dr, dt, db);
				if (pick === dl) x = panelRect.left - m;
				else if (pick === dr) x = panelRect.right + m;
				else if (pick === dt) y = panelRect.top - m;
				else y = panelRect.bottom + m;
				x = clamp(x, 14, Math.max(28, vw - 14));
				y = clamp(y, 14, Math.max(28, vh - 14));
			}
		}
		return { x, y };
	}

	/**
	 * @param {Glyph} g
	 * @param {number} alpha
	 */
	function paintGlyph(g, alpha) {
		if (alpha <= 0.004) return;
		const c = g.accent ? accent : ink;
		ctx.save();
		ctx.globalAlpha = clamp(alpha, 0, 1);
		ctx.translate(g.x, g.y);
		ctx.rotate(g.rot);
		ctx.font =
			'700 ' +
			Math.round(g.size) +
			'px "Sentient", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillStyle = 'rgb(' + c.r + ',' + c.g + ',' + c.b + ')';
		ctx.fillText(g.ch, 0, 0);
		ctx.restore();
	}

	function repaintStatic() {
		ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
		for (const g of glyphs) paintGlyph(g, g.alpha);
	}

	function ensureLoop() {
		if (raf || paused || reduced) return;
		raf = window.requestAnimationFrame(tick);
	}

	/**
	 * @param {number} now
	 */
	function tick(now) {
		raf = 0;
		if (paused) return;
		glyphs = glyphs.filter((g) => now - g.born < g.life);
		ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
		if (!glyphs.length) return; // idle: loop stops, page returns to empty
		for (const g of glyphs) {
			const fade = 1 - (now - g.born) / g.life;
			paintGlyph(g, g.alpha * (fade * fade * (3 - 2 * fade)));
		}
		raf = window.requestAnimationFrame(tick);
	}

	/**
	 * Plant literal characters as ghost glyphs. Callers pre-filter to
	 * printable input; this stays defensive (skips whitespace and
	 * controls, caps the burst) so a paste can never flood the field.
	 *
	 * @param {string} text
	 */
	function plant(text) {
		if (typeof text !== 'string' || !text) return;
		if (paused) return; // tab hidden: drop rather than queue
		readThemeColors();
		const chars = Array.from(text)
			.filter((ch) => {
				if (ch.trim() === '') return false;
				const cp = ch.codePointAt(0);
				return typeof cp === 'number' && cp > 31 && cp !== 127;
			})
			.slice(0, burstCap);
		if (!chars.length) return;
		const now = performance.now();
		for (const ch of chars) {
			const p = placeNearEditor();
			const isAccent = rand() < 1 / 12;
			/** @type {Glyph} */
			const g = {
				ch,
				x: p.x,
				y: p.y,
				size: coarse ? 24 + rand() * 26 : 30 + rand() * 42,
				rot: (rand() - 0.5) * 0.44,
				born: now,
				life: 5200 + rand() * 3800,
				alpha: isAccent ? 0.2 + rand() * 0.06 : 0.14 + rand() * 0.08,
				accent: isAccent
			};
			glyphs.push(g);
		}
		while (glyphs.length > maxGlyphs) glyphs.shift();
		if (reduced) {
			// No fade loop: newcomers appear at final alpha over the kept field.
			for (const g of glyphs.slice(-chars.length)) paintGlyph(g, g.alpha);
			return;
		}
		ensureLoop();
	}

	function retint() {
		readThemeColors();
		// The motion path picks the fresh palette up on its next frame;
		// the static path must repaint what is already on the bitmap.
		if (reduced) repaintStatic();
	}

	function resize() {
		const dpr = Math.min(2, window.devicePixelRatio || 1);
		const w = Math.max(1, Math.round(window.innerWidth * dpr));
		const h = Math.max(1, Math.round(window.innerHeight * dpr));
		if (canvas.width !== w || canvas.height !== h) {
			canvas.width = w;
			canvas.height = h;
		}
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		if (reduced) repaintStatic();
	}

	/**
	 * @param {boolean} p
	 */
	function setPaused(p) {
		if (p === paused) return;
		paused = p;
		if (p) {
			hiddenAt = performance.now();
			if (raf) {
				window.cancelAnimationFrame(raf);
				raf = 0;
			}
		} else {
			const gap = performance.now() - hiddenAt;
			for (const g of glyphs) g.born += gap;
			ensureLoop();
		}
	}

	/**
	 * @param {boolean} on
	 */
	function setReducedMotion(on) {
		if (on === reduced) return;
		reduced = on;
		if (on) {
			if (raf) {
				window.cancelAnimationFrame(raf);
				raf = 0;
			}
			repaintStatic();
		} else {
			const now = performance.now();
			for (const g of glyphs) g.born = now;
			ensureLoop();
		}
	}

	function destroy() {
		if (raf) window.cancelAnimationFrame(raf);
		raf = 0;
		glyphs = [];
		try {
			ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
		} catch {
			/* teardown must never throw */
		}
		try {
			canvas.remove();
		} catch {
			/* already gone */
		}
	}

	readThemeColors();
	resize();
	// Warm the display face so early glyphs already set in Sentient;
	// the mono fallback below still sets if the face arrives late.
	try {
		const pending = document.fonts.load('700 40px "Sentient"');
		if (pending && typeof pending.catch === 'function') pending.catch(() => {});
	} catch {
		/* decorative: fallback stack still sets */
	}

	return { plant, retint, resize, setPaused, setReducedMotion, destroy };
}
