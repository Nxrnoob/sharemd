import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { gateDoc, isCrawlerBot, resolveDoc, takeView } from '$lib/server/docs';
import { resolveDocLinks } from '$lib/server/doclinks';
import { grantCookieName, verifyGrant } from '$lib/server/grants';

// Loads pre-rendered HTML (no re-parse here).
// renderMarkdown() runs only at POST time in src/lib/server/markdown.ts.
// Gated states (gone / passwordRequired) return NO content (html '') but keep
// the same shape so the reader UI can render its gate screens.
export const load: PageServerLoad = async ({ params, cookies, request }) => {
	const row = await resolveDoc(params.id);
	if (!row) throw error(404, 'Not found');

	const base = {
		id: row.id,
		slug: row.slug,
		title: row.title,
		createdAt: row.createdAt
	};

	const gate = gateDoc(row, null);
	// An unlock grant stands in for the password: it proves one was already
	// supplied without the password ever touching a URL. The password itself is
	// deliberately not accepted from the query string, so a legacy `?pw=` link is
	// ignored rather than quietly reintroducing the leak.
	const granted =
		!gate.ok &&
		gate.status === 'locked' &&
		!!row.passwordHash &&
		verifyGrant(row.id, row.passwordHash, cookies.get(grantCookieName(row.id)));

	if (!gate.ok && !granted) {
		if (gate.status === 'gone') {
			return {
				...base,
				html: '',
				rawMarkdown: '',
				views: row.views,
				readTime: '',
				linkedPages: [],
				gone: true as const,
				goneReason: gate.reason,
				passwordRequired: false as const
			};
		}
		return {
			...base,
			html: '',
			rawMarkdown: '',
			views: row.views,
			readTime: '',
			linkedPages: [],
			gone: false as const,
			goneReason: null,
			passwordRequired: true as const
		};
	}

	const isBot = isCrawlerBot(request.headers.get('user-agent'));
	if (isBot) {
		const words = row.rawMarkdown.trim().split(/\s+/).filter(Boolean).length;
		const readMins = Math.max(1, Math.ceil(words / 200));
		return {
			...base,
			html: '',
			rawMarkdown: '',
			views: row.views,
			readTime: `${readMins} min read`,
			linkedPages: [],
			gone: false as const,
			goneReason: null,
			passwordRequired: false as const
		};
	}

	// Views increment only on successful serve; a lost atomic race reads as exhausted.
	if (!(await takeView(row.id))) {
		return {
			...base,
			html: '',
			rawMarkdown: '',
			views: row.views + 1,
			readTime: '',
			linkedPages: [],
			gone: true as const,
			goneReason: 'exhausted' as const,
			passwordRequired: false as const
		};
	}

	// Reading time from stored raw markdown (no re-parse of HTML needed).
	const words = row.rawMarkdown.trim().split(/\s+/).filter(Boolean).length;
	const readMins = Math.max(1, Math.ceil(words / 200));

	// Doc-to-doc references resolve at read time so links stay live as the
	// library evolves; the resolved targets also feed the "Linked pages" list.
	const { html, linked } = await resolveDocLinks(row.html, row.id);

	return {
		...base,
		html,
		rawMarkdown: row.rawMarkdown,
		views: row.views + 1,
		readTime: `${readMins} min read`,
		linkedPages: linked,
		gone: false as const,
		goneReason: null,
		passwordRequired: false as const
	};
};
