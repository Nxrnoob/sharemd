# Inky Drift

A seeded ambient flow-field for the ShareMD landing. Ink traces ride a slow
perlin current across the viewport, linger, and settle into the background
like sediment in still water. It is atmosphere, not a hero: if you notice
it before the editor, it is too loud.

## 1. Movement

Inky Drift belongs to the quiet corner of generative art that treats the
screen as a shallow tray of fluid rather than a stage. There is no center,
no climax, no loop point to wait for. Particles enter at the edges, wander
the field, and fade where they stop. The composition is deliberately
unbalanced and edge-weighted so the middle of the viewport — where the
editor lives — stays calm. Think of it as the visual equivalent of room
tone: present when you listen for it, invisible when you work.

## 2. Computational process

Each frame every particle samples a two-dimensional Perlin field at its
position (plus a slowly advancing temporal offset) and steers along the
resulting angle. The screen is never cleared; instead a translucent wash
of the background color is laid down each frame at very low alpha. Fresh
strokes are crisp, old strokes decay exponentially into the ground, and
the whole field carries a faint downward bias so traces appear to sink
and settle. Rendering is a single p5 canvas in instance mode, created
and destroyed with the component that owns it.

## 3. Noise and randomness

All randomness is seeded, never ambient. A small FNV hash of the active
theme id feeds both `randomSeed` and `noiseSeed`, so every theme owns one
stable atmosphere: Monochrome always drifts the same way, Nxr always
blooms violet in the same corners. Within a run, spawn positions, speeds,
and the one-in-seven accent strokes come from the seeded generator, which
means screenshots and screen recordings are reproducible. Randomness here
is a texture control, not a surprise generator.

## 4. Particle and field behavior

Particles are short-lived ink motes, not boids: no flocking, no
attraction, no repulsion. Each mote holds a position, a heading smoothed
toward the local field angle, and a lifespan. Roughly six in seven render
in the theme ink at whisper alpha; every seventh draws in the theme
accent at a slightly stronger alpha, so color appears as rare sediment
veins rather than confetti. On death a mote respawns at a random edge,
keeping density constant without pops or clusters.

## 5. Temporal evolution

The field breathes on two timescales. The fast scale is the per-frame
advection that draws the visible trails. The slow scale is the temporal
offset of the noise field itself, advancing a fraction of a step per
frame so currents reorganize over the course of a minute. Nothing ever
resets: because old paint only ever fades, the canvas holds a
thirty-second memory of where the ink has been. The piece has no ending
and no beginning; opening the page mid-drift is the intended encounter.

## 6. Parametric variation and restraint

Four knobs exist and all default to quiet: particle count (capped lower
on small screens), trail alpha, fade rate, and the accent ratio. The
craft lives in what was refused — no glow, no blur passes, no rounded
forms, no motion that survives `prefers-reduced-motion` (which gets a
single pre-settled static frame instead of a loop). Against the light
Latte theme the same parameters invert naturally: dark traces on a pale
ground at alphas low enough that body text always wins the contrast
fight. Every choice serves one test: does the editor still feel like
the only thing on the page?
