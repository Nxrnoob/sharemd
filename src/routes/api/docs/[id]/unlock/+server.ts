import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveDoc } from '$lib/server/docs';
import { verifyPassword } from '$lib/server/password';
import { checkRateLimit } from '$lib/server/rate-limit';
import { grantCookieName, grantValue } from '$lib/server/grants';

/**
 * Exchange a password for an unlock grant. The password arrives in the POST body
 * and never in a URL; the reply is an HttpOnly session cookie that lets the
 * page load resolve the gate.
 */
export const POST: RequestHandler = async ({ params, request, cookies, getClientAddress }) => {
	const ip = getClientAddress?.() ?? 'unknown';
	const { allowed } = await checkRateLimit(ip);
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

	const doc = await resolveDoc(params.id);
	if (!doc) return json({ error: 'Not found' }, { status: 404 });

	// Nothing to unlock. Answering ok keeps the caller's flow identical whether
	// or not the link happens to be protected.
	if (!doc.passwordHash) return json({ ok: true });

	if (!verifyPassword(password, doc.passwordHash)) {
		return json({ error: 'Wrong password. Try again.' }, { status: 401 });
	}

	cookies.set(grantCookieName(doc.id), grantValue(doc.id, doc.passwordHash), {
		path: '/',
		httpOnly: true,
		sameSite: 'lax'
		// Deliberately no maxAge: the grant is a session cookie, so closing the
		// browser re-locks the doc.
	});

	return json({ ok: true });
};