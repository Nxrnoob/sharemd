import { Marked } from 'marked';
import { gfmHeadingId } from 'marked-gfm-heading-id';
import DOMPurify from 'isomorphic-dompurify';
import { getSingletonHighlighter, type Highlighter } from 'shiki';

export const MAX_MARKDOWN_BYTES = 512 * 1024;

/** Strip null bytes (Postgres/SQLite + JSON safety). */
export function cleanInput(s: string): string {
	return s.replace(/\0/g, '');
}

let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
	if (!highlighterPromise) {
		highlighterPromise = getSingletonHighlighter({
			themes: ['github-light', 'github-dark'],
			langs: ['js', 'ts', 'json', 'bash', 'python', 'html', 'css', 'md', 'yaml', 'toml', 'rust', 'go']
		});
	}
	return highlighterPromise;
}

const marked = new Marked(gfmHeadingId({ prefix: 'user-content-' }));

marked.use({
	async walkTokens(token) {
		if (token.type === 'code') {
			const codeToken = token as { text: string; lang?: string };
			try {
				const hl = await getHighlighter();
				const lang = (codeToken.lang || 'plaintext').toLowerCase();
				const loaded = hl.getLoadedLanguages();
				const useLang = loaded.includes(lang) ? lang : 'plaintext';
				codeToken.text = hl.codeToHtml(codeToken.text, {
					lang: useLang,
					themes: { light: 'github-light', dark: 'github-dark' }
				}) as unknown as string;
				// Mark as pre-rendered HTML so the renderer outputs it raw.
				(token as { type: string; pre?: boolean; text: string }).type =
					'html' as never;
				(token as { pre?: boolean }).pre = true;
			} catch {
				// Fall through: leave code unhighlighted, marked escapes it.
			}
		}
	},
	renderer: {
		code(token: { text: string; pre?: boolean }): string {
			// If walkTokens pre-rendered via shiki, token.text is full <pre> HTML.
			if ((token as { pre?: boolean }).pre) return token.text + '\n';
			const escaped = token.text
				.replace(/&/g, '&amp;')
				.replace(/</g, '&lt;')
				.replace(/>/g, '&gt;');
			return `<pre><code>${escaped}</code></pre>\n`;
		}
	}
});

/**
 * Server-only: pre-render markdown to sanitized HTML at POST time.
 * Stored in `documents.html`; view routes must NOT re-parse.
 */
export async function renderMarkdown(raw: string): Promise<string> {
	const dirty = (await marked.parse(raw, { async: true })) as string;
	return DOMPurify.sanitize(dirty, {
		ADD_ATTR: ['target', 'class', 'style'],
		ADD_TAGS: ['span']
	});
}
