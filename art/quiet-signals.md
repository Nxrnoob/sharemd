# Quiet Signals

A seeded signal field for every ShareMD document. Layered horizontal
contours drift across a band like a seismograph at rest, one carrier line
carries the document's signature, and sparse sample markers pin the reading.
It is a cover, not a poster: if it competes with the title above which it
sits, it has failed.

## 1. Movement

Quiet Signals sits in the plotter-and-instrument tradition of generative
art — the lineage of oscilloscope traces, slow-scan television test cards,
and pen-plotter seismograms — where the image is a *reading* of an invisible
field rather than a scene. There is no figure, no horizon, no focal point.
The band is a stack of horizontal traces, each one a quiet measurement taken
across the width of the page, and the eye is allowed to skim them the way it
skims the grooves of a record. Where Inky Drift (the landing's ambient
field) is atmosphere in motion, Quiet Signals is deliberately still: a
document cover must hold still, because a document holds still.

## 2. Computational process

The whole system is a pure function from seed to SVG string. No canvas, no
p5, no DOM — the module runs identically on the server and in the browser,
and its output is geometry, never markup beyond paths, rects, and one
background fill. Each contour line is sampled at fixed intervals across the
width; at every sample the line's vertical offset comes from a small
fractional-Brownian stack built on one-dimensional value noise (smoothstep
interpolation over a seeded lattice, three octaves). A single stronger
"carrier" line runs across the band with the widest amplitude, and a handful
of small square markers are pinned to points along it, like readings taken
from the trace. A near-invisible set of horizontal scanline rules, drawn as
one path, gives the band its texture. Element counts are capped and scaled
to the canvas, so a 1200x630 rasterization and a 40-pixel thumbnail come
from the same function at the same cost profile.

## 3. Noise and randomness

All randomness is seeded, never ambient. The document's id is hashed with
FNV-1a into a 32-bit seed, which drives a mulberry32 generator; two noise
lattices are drawn from it first, in a fixed order, and every subsequent
decision — line count, baseline drift, amplitude, frequency, which few lines
carry the accent, where the markers land — consumes the same stream in the
same order. Same seed, identical bytes; different document, different field.
Randomness here is a texture control, not a surprise generator: it decides
how each field differs *within* a grammar that never changes.

## 4. Composition as a reading surface

The band is layered by loudness. The scanlines sit at five percent opacity
and are meant to be felt rather than seen. The contour lines whisper
between eight and twenty-four percent, biased toward flatness so most
traces read as calm rules and only a few rise into waves. Roughly one line
in seven is drawn in the accent color, so color appears as occasional
signal veins, never as confetti. The carrier line, at half strength, is the
loudest mark on the band and doubles as each document's fingerprint. The
palette is a parameter, not a constant: the same seed re-skinned through
the theme's paper, ink, and iris variables produces the same geometry in
the reader's colors — a document keeps its identity across every theme.

## 5. Temporal and parametric variation

The variation in this system is across documents, not across time. There is
no animation and no clock: the piece is identical on the thousandth view as
on the first, which is the correct temporal behavior for a reading surface.
Parametric variation comes from three sources — the seed (per document),
the canvas (line count and sample density scale with height and width), and
the palette (re-colored per theme without re-seeding). A thumbnail, a reader
banner, a 404 band, and a future OG rasterization are therefore all the
*same* artwork seen at different scales and dress, never different
artworks.

## 6. Craftsmanship and restraint

The craft lives as much in what was refused as in what was drawn: no
gradients, no glow, no blur, no rounded caps, no curves smoother than the
noise requires, no text inside the SVG (words belong to HTML, overlaid
afterward), no external requests of any kind. Every coordinate is rounded
before serialization, strokes declare `vector-effect: non-scaling-stroke`
so a stretched band keeps hairline weight, and the whole output is capped
well under two hundred kilobytes at OG dimensions. The edges stay sharp
because the product stays sharp. The standing test is the one the band was
built for: open the page and ask whether the document's first heading is
still the loudest thing on screen. If it is not, the field is too loud —
and the field is tuned so that it never is.
