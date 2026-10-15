import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listContributedMembers, resolveBundle, verifyBundleToken } from '$lib/server/bundles';

/**
 * List what other people added to a folder you created.
 *
 * Authorised by the bundle's delete token, exactly like the removal route —
 * this is owner tooling, not something a reader can call. Only contributions are
 * returned; the creator's own docs stay in their Library.
 *
 * The token travels in a POST body rather than the query string, for the same
 * reason the reader's password does not: a URL gets copied, bookmarked and sent
 * in Referer headers.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const { id } = params;
	if (!id) return json({ error: 'Missing id' }, { status: 400 });

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}
	const { token } = (body && typeof body === 'object' ? body : {}) as { token?: unknown };

	const bundle = await resolveBundle(id);
	if (!bundle || !bundle.deleteTokenHash) return json({ error: 'Not found' }, { status: 404 });

	if (typeof token !== 'string' || !token || !verifyBundleToken(bundle, token)) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	return json({ contributions: await listContributedMembers(bundle.id) });
};