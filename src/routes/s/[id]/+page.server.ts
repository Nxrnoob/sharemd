import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { gateDoc, resolveDoc, takeView } from '$lib/server/docs';

// Loads pre-rendered HTML (no re-parse here).
// renderMarkdown() runs only at POST time in src/lib/server/markdown.ts.
// Gated states (gone / passwordRequired) return NO content (html '') but keep
// the same shape so the reader UI can render its gate screens.
export const load: PageServerLoad = async ({ params, url }) => {
	const row = resolveDoc(params.id);
	if (!row) throw error(404, 'Not found');

	const base = {
		id: row.id,
		slug: row.slug,
		title: row.title,
		createdAt: row.createdAt
	};

	const gate = gateDoc(row, url.searchParams.get('pw'));
	if (!gate.ok) {
		if (gate.status === 'gone') {
			return {
				...base,
				html: '',
				views: row.views,
				readTime: '',
				gone: true as const,
				goneReason: gate.reason,
				passwordRequired: false as const
			};
		}
		return {
			...base,
			html: '',
			views: row.views,
			readTime: '',
			gone: false as const,
			goneReason: null,
			passwordRequired: true as const
		};
	}

	// Views increment only on successful serve; a lost atomic race reads as exhausted.
	if (!takeView(row.id)) {
		return {
			...base,
			html: '',
			views: row.views + 1,
			readTime: '',
			gone: true as const,
			goneReason: 'exhausted' as const,
			passwordRequired: false as const
		};
	}

	// Reading time from stored raw markdown (no re-parse of HTML needed).
	const words = row.rawMarkdown.trim().split(/\s+/).filter(Boolean).length;
	const readMins = Math.max(1, Math.ceil(words / 200));

	return {
		...base,
		html: row.html,
		views: row.views + 1,
		readTime: `${readMins} min read`,
		gone: false as const,
		goneReason: null,
		passwordRequired: false as const
	};
};
