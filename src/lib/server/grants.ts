import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Unlock grants.
 *
 * A password-protected doc or bundle used to be unlocked by putting the password
 * in the URL query string. That put it in the address bar, browser history,
 * bookmarks, sync history, proxy logs, and any Referer sent off the page. The
 * password no longer travels in a URL at all: the reader POSTs it once to an
 * unlock endpoint, and the server answers with an HttpOnly cookie that *proves*
 * the password was supplied without containing it.
 *
 * The grant is an HMAC keyed by the resource's own stored password hash, scoped
 * to the resource id. That choice buys three things for free: no plaintext ever
 * leaves the server, no extra secret or environment variable has to be deployed
 * alongside the app, and changing a password automatically invalidates every
 * grant issued under the old one because the key changes with it.
 */

const GRANT_CONTEXT = 'sharemd-grant:';

export function grantCookieName(resourceId: string): string {
	return `sm_gate_${resourceId}`;
}

export function grantValue(resourceId: string, passwordHash: string): string {
	return createHmac('sha256', passwordHash)
		.update(`${GRANT_CONTEXT}${resourceId}`)
		.digest('hex');
}

/** Constant-time compare. Returns false on any malformed input. Never throws. */
export function verifyGrant(
	resourceId: string,
	passwordHash: string,
	cookieValue: string | undefined | null
): boolean {
	if (!cookieValue) return false;
	let expected: Buffer;
	let actual: Buffer;
	try {
		expected = Buffer.from(grantValue(resourceId, passwordHash), 'hex');
		actual = Buffer.from(cookieValue, 'hex');
	} catch {
		return false;
	}
	return expected.length === actual.length && timingSafeEqual(expected, actual);
}