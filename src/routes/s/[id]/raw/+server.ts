import type { RequestHandler } from './$types';
import { gateDoc, resolveDoc, takeView } from '$lib/server/docs';
import { grantCookieName, verifyGrant } from '$lib/server/grants';
import { resolveDocBundleGate } from '$lib/server/bundles';

function toDownloadFilename(title: string | null | undefined, fallback: string): string {
	const slug = (title || '')
		.toLowerCase()
		.trim()
		.replace(/[*_`~\[\]()!#]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 60);
	return `${slug || fallback}.md`;
}

export const GET: RequestHandler = async ({ params, cookies }) => {
	const { id } = params;
	if (!id) return new Response('Missing id', { status: 400 });

	const row = await resolveDoc(id);
	if (!row) return new Response('Not found', { status: 404 });

	const gate = gateDoc(row, null);
	// Download must obey the same lock as the reader, and by the same rule: a
	// grant cookie, never a password in the query string.
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
		if (isGone) return new Response('Gone', { status: 410 });
		return new Response('Password required', { status: 403 });
	}

	if (!(await takeView(row.id))) {
		return new Response('Gone', { status: 410 });
	}

	const filename = toDownloadFilename(row.title || row.slug, row.id);

	return new Response(row.rawMarkdown, {
		headers: {
			'content-type': 'text/plain; charset=utf-8',
			'content-disposition': `attachment; filename="${filename}"`
		}
	});
};
