/**
 * The file-surface look, in one place.
 *
 * Two pages now draw the same idea: the folder a reader opens (/b/[id]) and
 * the owner's Library. A document is a hairline-bordered surface with a glyph,
 * a name, and a mono meta line; a container is typographic and set apart by a
 * rule rather than a box. Those decisions used to live as raw class strings
 * inline in each page, which is exactly how a design language rots — two
 * copies of "border-line bg-surface" drift apart within a month and nobody
 * can tell which one is correct.
 *
 * So they live here. Tailwind scans this file like any other source, and every
 * utility it needs appears as a literal somewhere in it, so the utilities still
 * generate. Layout details that genuinely differ between the two densities
 * (tile padding, centring, the row's flex direction) stay with the component
 * that owns them; only the shared surface is centralised.
 */

/** Bordered, filled, accent-on-hover. The contents of a folder, always boxed. */
export const FILE_BOX =
	'border border-line bg-surface transition hover:border-iris dark:border-night-line dark:bg-night-surface';

/** The unfilled variant, for things that are not a document yet: an add tile,
 *  a new-folder affordance, or a member that can no longer be opened. */
export const FILE_BOX_DASHED =
	'border border-dashed border-line transition hover:border-iris dark:border-night-line';

/** The document's name. Identical in a tile and in a row — only the surrounding
 *  box differs, so the type must not. */
export const FILE_NAME = 'text-[13.5px] leading-snug font-medium';

/** The "size" line under a name: mono, quiet, token-coloured. */
export const FILE_META = 'font-mono text-[11px] text-ink-soft dark:text-slate-500';

/** A hairline in the active theme. Containers are divided by these, not boxes. */
export const RULE = 'border-line dark:border-night-line';

/** The small all-caps kicker above a container's display title. */
export const EYEBROW = 'text-xs tracking-widest text-ink-soft uppercase dark:text-slate-500';

/** Secondary text under a title. */
export const SUBTLE = 'text-ink-soft dark:text-slate-400';

/**
 * Row actions, revealed rather than permanently drawn.
 *
 * A visitor tile has one verb; an owner row has a filing select and four
 * controls, and drawing all of them on every row turns the list into a wall. A
 * file manager's answer is to reveal them — but reveal them to *everyone*, not
 * just to people with a mouse:
 *
 *   - They are hidden only where a hover can actually happen: a pointer that
 *     can hover (`hover: hover`) on a screen wide enough to spare the room
 *     (`min-width: 64rem`). A tablet in landscape is wide but has no hover, so
 *     a width test alone would leave its owner unable to file, share or delete
 *     anything — the exact "hover-only" trap this is here to avoid. Anywhere
 *     else the actions are simply drawn. If an environment ever mis-reports,
 *     this fails open: the actions are visible, which is the safe direction.
 *   - While hidden they stay in the DOM and stay in tab order, so Tab still
 *     reaches them, and `group-focus-within` brings them in on arrival.
 *     Keyboard is the other way in, and it works on a touch screen too.
 *
 * `pointer-events` follows opacity in both states, so a hidden button is never
 * an invisible-but-clickable target.
 *
 * The behaviour belongs to both row types at once — the list row and the
 * sidebar row — so they cannot drift apart. Where the actions *sit* when they
 * appear is each row's own decision: `ACTION_OVERLAY` anchors them.
 */
/**
 * Revealed actions that reserve *nothing*.
 *
 * On a wide, hover-capable screen they are lifted out of flow and laid over the
 * row's own trailing space, so a name is never squeezed by controls that are
 * not currently showing — four buttons cost a resting row zero width. Everywhere
 * else (`contents`) they drop back into the row's flex line, right-aligned
 * beneath it, which is what a touch screen and a narrow window both want.
 *
 * The class is written out in full rather than assembled from parts on purpose.
 * Tailwind finds candidates by scanning raw source text, so a value built by
 * string concatenation — however tidy — is invisible to it and the utilities
 * silently never generate. That failure is invisible too: the row still lays
 * out, the buttons are simply always there.
 *
 * Pair with an anchor — `right-0` over a trailing count, `right-full` to the
 * left of a trailing control. That half is layout, and layout is the row's own
 * decision.
 */
export const ACTION_OVERLAY =
	'opacity-100 pointer-events-auto contents [@media(hover:hover)_and_(min-width:64rem)]:pointer-events-none [@media(hover:hover)_and_(min-width:64rem)]:opacity-0 [@media(hover:hover)_and_(min-width:64rem)]:group-hover:pointer-events-auto [@media(hover:hover)_and_(min-width:64rem)]:group-hover:opacity-100 [@media(hover:hover)_and_(min-width:64rem)]:group-focus-within:pointer-events-auto [@media(hover:hover)_and_(min-width:64rem)]:group-focus-within:opacity-100 [@media(min-width:64rem)]:absolute [@media(min-width:64rem)]:top-1/2 [@media(min-width:64rem)]:-translate-y-1/2';

/** The quiet outlined button used for row actions and the filing select.
 *  `focus:` is here because a native `<select>` is not in the global
 *  `a, button, input, textarea, [tabindex]` focus-ring rule and would otherwise
 *  fall back to the user-agent's thin default ring. */
export const FILE_CONTROL =
	'shrink-0 rounded-sm border border-line px-2.5 py-1 text-[13px] font-medium text-ink-soft transition hover:border-iris hover:text-iris focus:border-iris focus:text-iris active:scale-[0.98] dark:border-night-line dark:text-slate-400';
