import { sql } from 'drizzle-orm';
import { db } from './db';
import { documents, type Document } from './db/schema';
import { gateDoc, resolveDoc } from './docs';

export interface LinkedPage {
	title: string;
	href: string;
}

const MAX_LINKED = 12;

/** Decode the handful of entities marked escapes inside attribute values. */
function decodeEntities(s: string): string {
	return s
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'");
}

/** Case-insensitive exact title match — the last-resort reference form. */
async function resolveByTitle(title: string): Promise<Document | undefined> {
	return db
		.select()
		.from(documents)
		.where(sql`lower(${documents.title}) = ${title.toLowerCase()}`)
		.get();
}

/**
 * Resolve doc-to-doc references at READ time, not share time. That choice is
 * the whole point: a doc created AFTER the one linking to it still resolves,
 * and no stored HTML ever needs re-saving — existing docs benefit untouched.
 *
 * Recognised reference forms for `[label](target)`:
 *   /s/<slug-or-id>                     already internal — kept, listed below
 *   <slug>                              bare slug or doc id
 *   ./<slug> · <slug>.md · ./<slug>.md  editor-style relative file links
 *   <Doc Title>                         case-insensitive exact title match
 *
 * External http(s), mailto/tel and #anchors are left untouched, and an
 * unresolvable target is left exactly as authored — a link to something that
 * is not a doc must keep behaving like whatever it is.
 *
 * Input is the DOMPurify-sanitized HTML stored at share time; this pass only
 * rewrites `href` values to `/s/<slug-or-id>` built from server-owned data,
 * so it never reintroduces unsanitized content.
 */
export async function resolveDocLinks(
	html: string,
	selfId: string
): Promise<{ html: string; linked: LinkedPage[] }> {
	if (!html) return { html, linked: [] };

	// Collect distinct hrefs with their exact encoded attribute text so the
	// rewrite matches the bytes actually in the document.
	const attrs = new Map<string, string>(); // decoded href -> encoded attr
	const hrefRe = /<a\s[^>]*?href="([^"]*)"/g;
	let m: RegExpExecArray | null;
	while ((m = hrefRe.exec(html))) {
		const decoded = decodeEntities(m[1]);
		if (!attrs.has(decoded)) attrs.set(decoded, m[1]);
	}
	if (attrs.size === 0) return { html, linked: [] };

	const resolved = new Map<string, Document | null>();
	const linked = new Map<string, LinkedPage>();
	let out = html;

	for (const [raw, encoded] of attrs) {
		const target = raw.trim();
		if (!target) continue;

		let doc: Document | undefined;

		if (/^\/s\//.test(target)) {
			// Already internal — keep the href, surface it as a linked page.
			try {
				doc = await resolveDoc(decodeURIComponent(target.slice(3)));
			} catch {
				doc = await resolveDoc(target.slice(3));
			}
		} else if (
			/^(https?:)?\/\//i.test(target) ||
			/^(mailto|tel):/i.test(target) ||
			target.startsWith('#')
		) {
			continue;
		} else {
			let candidate = target;
			try {
				candidate = decodeURIComponent(candidate);
			} catch {
				/* malformed escape — match on the raw text */
			}
			candidate = candidate.replace(/^\.\//, '').replace(/\.md$/i, '').trim();
			// Anything path-like is not a doc reference; don't guess.
			if (!candidate || /[/\\]/.test(candidate)) continue;
			const key = candidate.toLowerCase();
			if (!resolved.has(key)) {
				resolved.set(key, (await resolveDoc(candidate)) ?? (await resolveByTitle(candidate)) ?? null);
			}
			doc = resolved.get(key) ?? undefined;
		}

		if (!doc) continue;

		const href = `/s/${doc.slug ?? doc.id}`;
		if (href !== raw) {
			out = out.split(`href="${encoded}"`).join(`href="${href}"`);
		}

		// Linked-pages list: skip self, skip dead targets (expired/exhausted —
		// the rewrite above still points at the honest "gone" screen), cap size.
		if (doc.id !== selfId && linked.size < MAX_LINKED) {
			const gate = gateDoc(doc, null);
			if (gate.ok || gate.status === 'locked') {
				linked.set(href, { title: doc.title, href });
			}
		}
	}

	return { html: out, linked: [...linked.values()] };
}