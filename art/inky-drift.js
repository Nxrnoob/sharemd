// @ts-nocheck
/**
 * Inky Drift — seeded ambient flow-field sketch factory (p5 instance mode).
 *
 * Pure paint: no Svelte state, no DOM writes outside its own canvas, so it
 * can never feed a reactive loop. The owner component drives it through
 * the small imperative API returned by `updateTheme()` / `renderStatic()`.
 *
 * Philosophy: art/inky-drift.md
 */

function hashSeed(str) {
	let h = 2166136261;
	for (let i = 0; i < str.length; i++) {
		h ^= str.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}

export function createInkyDrift(P5, mount, opts = {}) {
	const reducedMotion = opts.reducedMotion === true;
	let p = null;
	let particles = [];
	let t = 0;
	let tokens = opts.tokens;
	let seed = hashSeed(opts.themeId || 'monochrome');
	let settled = false;

	const isSmall = () => Math.min(window.innerWidth, window.innerHeight) < 640;
	const count = () => (isSmall() ? 34 : 88);

	function spawn(p5, i, anywhere) {
		const w = p5.width;
		const h = p5.height;
		// Edge-weighted spawn keeps the middle of the viewport calm.
		const edge = Math.floor(p5.random(4));
		let x = p5.random(w);
		let y = p5.random(h);
		if (!anywhere || p5.random() < 0.55) {
			if (edge === 0) y = p5.random(h * 0.12);
			else if (edge === 1) y = h - p5.random(h * 0.12);
			else if (edge === 2) x = p5.random(w * 0.12);
			else x = w - p5.random(w * 0.12);
		}
		return {
			x,
			y,
			px: x,
			py: y,
			speed: p5.random(0.35, 0.9),
			life: p5.random(120, 420),
			age: 0,
			accent: i % 7 === 3,
			wob: p5.random(1000)
		};
	}

	function readTokens() {
		return tokens;
	}

	function step(p5) {
		const tk = readTokens();
		const ink = p5.color(tk.ink);
		const accent = p5.color(tk.accent);
		const fade = p5.color(tk.bg);
		fade.setAlpha(7);
		p5.background(fade);
		t += 0.0016;
		const scale = 0.0016;
		for (let i = 0; i < particles.length; i++) {
			const m = particles[i];
			const a =
				p5.noise(m.x * scale, m.y * scale, t + m.wob * 0.0001) * Math.PI * 4;
			m.px = m.x;
			m.py = m.y;
			m.x += Math.cos(a) * m.speed;
			m.y += Math.sin(a) * m.speed + 0.12; // sediment bias: traces sink
			m.age++;
			const c = m.accent ? accent : ink;
			c.setAlpha(m.accent ? 34 : 18);
			p5.stroke(c);
			p5.strokeWeight(m.accent ? 1.2 : 1);
			p5.line(m.px, m.py, m.x, m.y);
			if (
				m.age > m.life ||
				m.x < -20 ||
				m.x > p5.width + 20 ||
				m.y < -20 ||
				m.y > p5.height + 20
			) {
				particles[i] = spawn(p5, i, false);
			}
		}
	}

	function boot(p5) {
		p5.randomSeed(seed);
		p5.noiseSeed(seed);
		p5.noiseDetail(3, 0.55);
		particles = [];
		for (let i = 0; i < count(); i++) particles.push(spawn(p5, i, true));
		t = p5.random(100);
		// Pre-settle: lay down history so frame one already holds memory.
		const bg = p5.color(tokens.bg);
		p5.background(bg);
		const warmup = reducedMotion ? 320 : 90;
		p5.noLoop();
		for (let s = 0; s < warmup; s++) {
			// Step without the per-frame fade cost ballooning: reuse step().
			step(p5);
		}
		settled = true;
		if (!reducedMotion) p5.loop();
	}

	const sketch = (p5) => {
		p5.setup = () => {
			const c = p5.createCanvas(window.innerWidth, window.innerHeight);
			c.elt.setAttribute('aria-hidden', 'true');
			p5.pixelDensity(Math.min(2, p5.displayDensity()));
			p5.frameRate(30);
			boot(p5);
		};
		p5.draw = () => {
			if (!settled) return;
			step(p5);
		};
		p5.windowResized = () => {
			p5.resizeCanvas(window.innerWidth, window.innerHeight);
			boot(p5);
		};
	};

	return {
		mount() {
			if (p) return;
			p = new P5(sketch, mount);
		},
		/** Re-seed + repaint for a new theme. Synchronous, cheap, no state. */
		updateTheme(nextTokens, nextThemeId) {
			tokens = nextTokens;
			seed = hashSeed(nextThemeId || 'monochrome');
			if (!p) return;
			boot(p);
		},
		pause() {
			if (p && !reducedMotion) p.noLoop();
		},
		resume() {
			if (p && !reducedMotion && settled) p.loop();
		},
		destroy() {
			if (p) {
				try {
					p.remove();
				} catch {
					/* already gone */
				}
				p = null;
			}
		}
	};
}
