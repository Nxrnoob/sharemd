import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { gateBundle, getBundleMembers, resolveBundle, takeBundleView } from '$lib/server/bundles';

/**
 * The bundle index. Loads the membership list, not document content — every
 * member keeps its own /s/<id> page, its own gate, and its own view count.
 *
 * Gated states return NO members so a locked or expired bundle reveals nothing,
 * exactly as the document reader does.
 */
export const load: PageServerLoad = async ({ params, url }) => {
	const bundle = await resolveBundle(params.id);
	if (!bundle) throw error(404, 'Not found');

	const base = {
		id: bundle.id,
		slug: bundle.slug,
		title: bundle.title,
		createdAt: bundle.createdAt
	};

	const gate = gateBundle(bundle, url.searchParams.get('pw'));
	if (!gate.ok) {
		return {
			...base,
			members: [],
			views: bundle.views,
			gone: gate.status === 'gone',
			goneReason: gate.status === 'gone' ? gate.reason : null,
			passwordRequired: gate.status === 'locked'
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
			passwordRequired: false
		};
	}

	const members = await getBundleMembers(bundle.id);
	return {
		...base,
		members,
		views: bundle.views + 1,
		gone: false,
		goneReason: null,
		passwordRequired: false
	};
};