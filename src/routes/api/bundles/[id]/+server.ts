import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteBundle, resolveBundle, verifyBundleToken } from '$lib/server/bundles';
import { checkRateLimit } from '$lib/server/rate-limit';

/**
 * Deleting a bundle removes the bundle and its membership rows only. Every
 * member doc survives and keeps working at its own /s/<id> — the bundle owns
 * a list of links, never the documents behind them.
 */
export const DELETE: RequestHandler = async ({ params, request, getClientAddress }) => {
	const ip = getClientAddress?.() ?? 'unknown';
	const { allowed } = await checkRateLimit(ip, 'edit');
	if (!allowed) {
		return json({ error: 'Rate limit exceeded. Try again later.' }, { status: 429 });
	}

	const { id } = params;
	if (!id) return json({ error: 'Missing id' }, { status: 400 });

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}
	const { token } = body as { token?: unknown };

	// Same indistinguishable 404 as the doc endpoint: unknown key and a
	// tokenless bundle look identical, so this is not an existence oracle.
	const bundle = await resolveBundle(id);
	if (!bundle || !bundle.deleteTokenHash) return json({ error: 'Not found' }, { status: 404 });

	if (typeof token !== 'string' || !token || !verifyBundleToken(bundle, token)) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	await deleteBundle(bundle.id);
	return json({ deleted: true });
};