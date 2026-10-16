import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveDoc } from '$lib/server/docs';
import { getDocBundles, type Bundle } from '$lib/server/bundles';
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

	const doc = await resolveDoc(params.id);
	if (!doc) return json({ error: 'Not found' }, { status: 404 });

	if (doc.passwordHash) {
		if (!verifyPassword(password, doc.passwordHash)) {
			return json({ error: 'Wrong password. Try again.' }, { status: 401 });
		}
		cookies.set(grantCookieName(doc.id), grantValue(doc.id, doc.passwordHash), {
			path: '/',
			httpOnly: true,
			sameSite: 'lax'
		});
		return json({ ok: true });
	}

	// Document has no password of its own. Check if it belongs to parent bundles with passwords.
	const parentBundles = await getDocBundles(doc.id);
	const protectedBundles = parentBundles.filter((b) => !!b.passwordHash);

	if (protectedBundles.length === 0) {
		return json({ ok: true });
	}

	let matchedBundle: Bundle | null = null;
	for (const b of protectedBundles) {
		if (b.passwordHash && verifyPassword(password, b.passwordHash)) {
			matchedBundle = b;
			break;
		}
	}

	if (!matchedBundle || !matchedBundle.passwordHash) {
		return json({ error: 'Wrong password. Try again.' }, { status: 401 });
	}

	cookies.set(grantCookieName(matchedBundle.id), grantValue(matchedBundle.id, matchedBundle.passwordHash), {
		path: '/',
		httpOnly: true,
		sameSite: 'lax'
	});

	return json({ ok: true });
};