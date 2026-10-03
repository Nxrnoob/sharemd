/**
 * Server-side re-export of the Quiet Signals cover generator.
 *
 * The implementation lives in `$lib/cover.ts` because it is isomorphic:
 * client surfaces (reader banner, recent thumbs, 404 band) must call it
 * at runtime to re-theme via the palette param, and SvelteKit forbids
 * importing `$lib/server/*` from client code. Server bundles (e.g. a
 * future OG rasterization endpoint) import from here.
 */
export {
	renderCoverSVG,
	hashSeed,
	DEFAULT_COVER_PALETTE,
	type CoverPalette,
	type CoverOptions
} from '$lib/cover';
