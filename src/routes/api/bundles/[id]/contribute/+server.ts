import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { contributeDoc, gateBundle, resolveBundle } from '$lib/server/bundles';
import { verifyGrant } from '$lib/server/grants';
import { grantCookieName } from '$lib/server/grants';
import { checkRateLimit } from '$lib/server/rate-limit';
import { MAX_MARKDOWN_BYTES, cleanInput, renderMarkdown } from '$lib/server/markdown';

/** Display name cap; anything longer is truncated rather than rejected. */
const MAX_CONTRIBUTOR_NAME = 60;

/**
 * Add your own doc to a shared folder.
 *
 * Authorisation is the unlock grant cookie, not a password in a URL and not any
 * account: the same HttpOnly grant that lets the page load render the folder
 * index is what authorises a write here. Someone who has typed the folder
 * password in this browser may contribute.
 *
 * Requires the folder to be password-gated. An open folder would accept writes
 * from anyone who ever opened the link, which is a spam hole rather than
 * collaboration — so contributions are opt-in by the creator setting a password.
 */
export const POST: RequestHandler = async ({ params, request, cookies, getClientAddress }) => {
	const ip = getClientAddress?.() ?? 'unknown';
	const { allowed } = await checkRateLimit(ip);
	if (!allowed) {
		return json({ error: 'Rate limit exceeded (20/hr)' }, { status: 429 });
	}

	const bundle = await resolveBundle(params.id);
	if (!bundle) return json({ error: 'Not found' }, { status: 404 });

	if (!bundle.passwordHash) {
		return json({ error: 'This folder is not accepting contributions.' }, { status: 403 });
	}

	if (!verifyGrant(bundle.id, bundle.passwordHash, cookies.get(grantCookieName(bundle.id)))) {
		return json({ error: 'Unlock the folder first.' }, { status: 401 });
	}

	// The grant covers the password, so only the lifetime gates can still close
	// the folder between unlock and write.
	const gate = gateBundle(bundle, null);
	if (!gate.ok && gate.status === 'gone') {
		return json({ error: 'This folder link has expired or hit its view limit.' }, { status: 410 });
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}

	const { title, markdown, contributor } = (body && typeof body === 'object' ? body : {}) as {
		title?: unknown;
		markdown?: unknown;
		contributor?: unknown;
	};

	if (typeof title !== 'string' || typeof markdown !== 'string') {
		return json({ error: 'title and markdown must be strings' }, { status: 400 });
	}

	const cleanTitle = cleanInput(title).trim().slice(0, 200);
	if (!cleanTitle) return json({ error: 'title must be non-empty' }, { status: 400 });
	if (!markdown.trim()) return json({ error: 'markdown must be non-empty' }, { status: 400 });
	if (Buffer.byteLength(markdown, 'utf8') > MAX_MARKDOWN_BYTES) {
		return json({ error: 'markdown exceeds 512KB' }, { status: 413 });
	}

	// Optional and free-form: this is a courtesy label, never an identity claim,
	// and it grants nothing. Trimmed and capped rather than validated.
	const contributorName =
		typeof contributor === 'string' ? cleanInput(contributor).trim().slice(0, MAX_CONTRIBUTOR_NAME) : '';

	const cleanMd = cleanInput(markdown);
	const html = await renderMarkdown(cleanMd);

	const res = await contributeDoc(bundle.id, cleanTitle, cleanMd, html, contributorName || null);
	if (!res.ok) {
		return json({ error: 'This folder is full.' }, { status: 409 });
	}

	// The token is returned once so the contributor can edit or delete their own
	// doc. It authorises nothing else — not the folder, not anyone else's doc.
	return json({ ok: true, id: res.docId, title: cleanTitle, deleteToken: res.deleteToken }, { status: 201 });
};