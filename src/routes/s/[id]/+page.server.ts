import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { gateDoc, isCrawlerBot, resolveDoc, takeView } from '$lib/server/docs';
import { resolveDocLinks } from '$lib/server/doclinks';
import { grantCookieName, verifyGrant } from '$lib/server/grants';
import {
	gateBundle,
	getBundleMembers,
	getDocBundles,
	resolveBundle,
	resolveDocBundleGate,
	type Bundle
} from '$lib/server/bundles';

// Loads pre-rendered HTML (no re-parse here).
// renderMarkdown() runs only at POST time in src/lib/server/markdown.ts.
// Gated states (gone / passwordRequired) return NO content (html '') but keep
// the same shape so the reader UI can render its gate screens.
export const load: PageServerLoad = async ({ params, cookies, request, url }) => {
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

	const bundleGate = await resolveDocBundleGate(
		row.id,
		Boolean(row.passwordHash),
		(name) => cookies.get(name)
	);

	const isLocked = (!gate.ok && gate.status === 'locked' && !granted) || bundleGate.locked;
	const isGone = !gate.ok && gate.status === 'gone';

	if (isGone || isLocked) {
		if (isGone) {
			return {
				...base,
				title: 'Unavailable doc',
				html: '',
				rawMarkdown: '',
				views: row.views,
				readTime: '',
				linkedPages: [],
				gone: true as const,
				goneReason: gate.reason,
				passwordRequired: false as const,
				folderContext: null
			};
		}
		return {
			...base,
			title: 'Locked doc',
			html: '',
			rawMarkdown: '',
			views: row.views,
			readTime: '',
			linkedPages: [],
			gone: false as const,
			goneReason: null,
			passwordRequired: true as const,
			folderContext: null
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
			passwordRequired: false as const,
			folderContext: null
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
			passwordRequired: false as const,
			folderContext: null
		};
	}

	// Reading time from stored raw markdown (no re-parse of HTML needed).
	const words = row.rawMarkdown.trim().split(/\s+/).filter(Boolean).length;
	const readMins = Math.max(1, Math.ceil(words / 200));

	// Doc-to-doc references resolve at read time so links stay live as the
	// library evolves; the resolved targets also feed the "Linked pages" list.
	const { html, linked } = await resolveDocLinks(row.html, row.id);
	// Folder tabs bar resolution: if this doc was opened from a folder,
	// or belongs to a single parent folder, resolve the folder's sibling files.
	let folderContext: {
		id: string;
		title: string;
		slug: string | null;
		href: string;
		members: {
			id: string;
			title: string;
			slug: string | null;
			href: string;
			gone: 'expired' | 'exhausted' | null;
		}[];
	} | null = null;

	const fromParam = url.searchParams.get('from');
	let targetBundleKey: string | null = null;
	if (fromParam) {
		const match = fromParam.match(/^\/b\/([A-Za-z0-9_-]{1,64})$/);
		if (match) targetBundleKey = match[1];
	}

	let parentBundle: Bundle | undefined;
	if (targetBundleKey) {
		parentBundle = await resolveBundle(targetBundleKey);
	}

	// Fall back to first bundle if doc only belongs to one folder
	if (!parentBundle) {
		const docBundles = await getDocBundles(row.id);
		if (docBundles.length === 1) {
			parentBundle = docBundles[0];
		}
	}

	if (parentBundle) {
		// Verify visitor is authorized to view this folder
		const bGate = gateBundle(parentBundle, null);
		const bGranted =
			!bGate.ok &&
			bGate.status === 'locked' &&
			!!parentBundle.passwordHash &&
			verifyGrant(parentBundle.id, parentBundle.passwordHash, cookies.get(grantCookieName(parentBundle.id)));

		if (bGate.ok || bGranted) {
			const members = await getBundleMembers(parentBundle.id);
			if (members.length > 1) {
				const bundleHref = `/b/${parentBundle.slug ?? parentBundle.id}`;
				folderContext = {
					id: parentBundle.id,
					title: parentBundle.title,
					slug: parentBundle.slug,
					href: bundleHref,
					members: members.map((m) => ({
						id: m.id,
						title: m.title,
						slug: m.slug,
						href: `/s/${m.slug ?? m.id}?from=${encodeURIComponent(bundleHref)}`,
						gone: m.gone
					}))
				};
			}
		}
	}

	return {
		...base,
		html,
		rawMarkdown: row.rawMarkdown,
		views: row.views + 1,
		readTime: `${readMins} min read`,
		linkedPages: linked,
		gone: false as const,
		goneReason: null,
		passwordRequired: false as const,
		folderContext
	};
};
