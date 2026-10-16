import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveBundle } from '$lib/server/bundles';
import { verifyPassword } from '$lib/server/password';
import { checkRateLimit } from '$lib/server/rate-limit';
import { grantCookieName, grantValue } from '$lib/server/grants';

/**
 * Exchange a folder password for an unlock grant, mirroring the document reader.
 * The grant gates the bundle index only; each member doc keeps its own gate and
 * its own view count.
 */
export const POST: RequestHandler = async ({ params, request, cookies, getClientAddress }) => {
	const ip = getClientAddress?.() ?? 'unknown';
	const { allowed } = await checkRateLimit(ip, 'unlock');
	if (!allowed) {
		return json({ error: 'Too many attempts. Try again later.' }, { status: 429 });
	}

	let password = '';
	try {
		const body = (await request.json()) as { password?: unknown };
		if (typeof body.password === 'string') password = body.password;
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}

	const bundle = await resolveBundle(params.id);
	if (!bundle) return json({ error: 'Not found' }, { status: 404 });

	if (!bundle.passwordHash) return json({ ok: true });

	if (!verifyPassword(password, bundle.passwordHash)) {
		return json({ error: 'Wrong password. Try again.' }, { status: 401 });
	}

	cookies.set(grantCookieName(bundle.id), grantValue(bundle.id, bundle.passwordHash), {
		path: '/',
		httpOnly: true,
		sameSite: 'lax'
	});

	return json({ ok: true });
};