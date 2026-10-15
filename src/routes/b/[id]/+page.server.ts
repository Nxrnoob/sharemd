import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { gateBundle, getBundleMembers, resolveBundle, takeBundleView } from '$lib/server/bundles';
import { grantCookieName, verifyGrant } from '$lib/server/grants';

/**
 * The bundle index. Loads the membership list, not document content — every
 * member keeps its own /s/<id> page, its own gate, and its own view count.
 *
 * Gated states return NO members so a locked or expired bundle reveals nothing,
 * exactly as the document reader does.
 */
export const load: PageServerLoad = async ({ params, cookies }) => {
	const bundle = await resolveBundle(params.id);
	if (!bundle) throw error(404, 'Not found');

	const base = {
		id: bundle.id,
		slug: bundle.slug,
		title: bundle.title,
		createdAt: bundle.createdAt,
		// The creator's colourway for this folder. A presentation choice, not a
		// gate — the reader can still override it for their own session.
		theme: bundle.theme
	};

	const gate = gateBundle(bundle, null);
	// The folder password is never read from the URL; an unlock grant from the
	// unlock endpoint stands in for it, exactly as on the document reader.
	const granted =
		!gate.ok &&
		gate.status === 'locked' &&
		!!bundle.passwordHash &&
		verifyGrant(bundle.id, bundle.passwordHash, cookies.get(grantCookieName(bundle.id)));

	if (!gate.ok && !granted) {
		return {
			...base,
			members: [],
			views: bundle.views,
			gone: gate.status === 'gone',
			goneReason: gate.status === 'gone' ? gate.reason : null,
			passwordRequired: gate.status === 'locked',
			// A locked folder is precisely the one nobody has unlocked yet.
			canContribute: false
		};
	}

	// A lost race on the last view reads as exhausted, same as the doc reader.
	if (!(await takeBundleView(bundle.id))) {
		return {
			...base,
			members: [],
			views: bundle.views + 1,
			gone: true,
			goneReason: 'exhausted' as const,
			passwordRequired: false,
			canContribute: false
		};
	}

	const members = await getBundleMembers(bundle.id);
	return {
		...base,
		members,
		views: bundle.views + 1,
		gone: false,
		goneReason: null,
		passwordRequired: false,
		// Contributions are only open on a password-gated folder: that password
		// is the whole authorisation, and an ungated folder would accept writes
		// from anyone who ever opened the link.
		canContribute: !!bundle.passwordHash
	};
};