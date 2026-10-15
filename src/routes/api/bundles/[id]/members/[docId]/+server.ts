import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { removeContributedMember, resolveBundle, verifyBundleToken } from '$lib/server/bundles';
import { checkRateLimit } from '$lib/server/rate-limit';

/**
 * Remove a doc somebody contributed to your folder.
 *
 * Authorised by the bundle's own delete token, not the doc's. The doc's token
 * belongs to whoever contributed it, so this is the only route by which the
 * folder owner can take something out — and it is scoped to contributions, so it
 * can never reach a doc the owner put in themselves. Those stay managed from
 * their Library, exactly as before.
 */
export const DELETE: RequestHandler = async ({ params, request, getClientAddress }) => {
	const ip = getClientAddress?.() ?? 'unknown';
	const { allowed } = await checkRateLimit(ip);
	if (!allowed) {
		return json({ error: 'Rate limit exceeded (20/hr)' }, { status: 429 });
	}

	const { id, docId } = params;
	if (!id || !docId) return json({ error: 'Missing id' }, { status: 400 });

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

	const res = await removeContributedMember(bundle, docId);
	if (!res.ok) {
		// A non-contribution and a non-member are reported the same way, so this
		// cannot be used to probe which docs a folder holds.
		return json({ error: 'Not found' }, { status: 404 });
	}

	return json({ removed: true });
};