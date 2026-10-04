import { Marked, type Tokens } from 'marked';
import { gfmHeadingId } from 'marked-gfm-heading-id';
import DOMPurify from 'isomorphic-dompurify';
import { getSingletonHighlighter, type Highlighter } from 'shiki';
import katex from 'katex';

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
	extensions: [
		{
			name: 'blockMath',
			level: 'block',
			start(src: string) {
				return src.indexOf('$$');
			},
			tokenizer(src: string) {
				const match = src.match(/^\$\$([\s\S]+?)\$\$(?:\n|$)/);
				if (match) {
					return {
						type: 'blockMath',
						raw: match[0],
						text: match[1].trim()
					};
				}
				return undefined;
			},
			renderer(token: Tokens.Generic) {
				const mathText = typeof token.text === 'string' ? token.text : '';
				const rendered = katex.renderToString(mathText, { displayMode: true, throwOnError: false });
				return `<div class="katex-display">${rendered}</div>\n`;
			}
		},
		{
			name: 'inlineMath',
			level: 'inline',
			start(src: string) {
				return src.indexOf('$');
			},
			tokenizer(src: string) {
				const match = src.match(/^\$([\S](?:[\s\S]*?[\S])?)\$(?!\d)/);
				if (match) {
					return {
						type: 'inlineMath',
						raw: match[0],
						text: match[1].trim()
					};
				}
				return undefined;
			},
			renderer(token: Tokens.Generic) {
				const mathText = typeof token.text === 'string' ? token.text : '';
				return katex.renderToString(mathText, { displayMode: false, throwOnError: false });
			}
		}
	],
	async walkTokens(token) {
		if (token.type === 'code') {
			const codeToken = token as { text: string; lang?: string };
			const lang = (codeToken.lang || '').toLowerCase();
			if (lang === 'mermaid') {
				// Designer-lane contract: emit raw text for client-side mermaid rendering.
				// Skip Shiki; DOMPurify (below) keeps class on pre/code.
				const escaped = codeToken.text
					.replace(/&/g, '&amp;')
					.replace(/</g, '&lt;')
					.replace(/>/g, '&gt;');
				codeToken.text =
					`<pre class="mermaid-block"><code>${escaped}</code></pre>`;
				(token as { type: string; pre?: boolean; text: string }).type =
					'html' as never;
				(token as { pre?: boolean }).pre = true;
				return;
			}
			try {
				const hl = await getHighlighter();
				if (lang && !hl.getLoadedLanguages().includes(lang)) {
					try {
						await hl.loadLanguage(lang as never);
					} catch {
						// unknown language alias, fallback to plaintext
					}
				}
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
		},
		blockquote(token: Tokens.Blockquote): string {
			const firstToken = token.tokens[0];
			const text = firstToken && 'text' in firstToken && typeof firstToken.text === 'string' ? firstToken.text : '';
			const match = text.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*\n?([\s\S]*)$/i);
			if (match) {
				const kind = match[1].toLowerCase();
				if (firstToken && 'tokens' in firstToken && Array.isArray(firstToken.tokens)) {
					const inlineFirst = firstToken.tokens[0];
					if (inlineFirst && inlineFirst.type === 'text' && typeof inlineFirst.text === 'string') {
						inlineFirst.text = inlineFirst.text.replace(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*\n?/i, '');
						if ('raw' in inlineFirst && typeof inlineFirst.raw === 'string') {
							inlineFirst.raw = inlineFirst.raw.replace(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*\n?/i, '');
						}
					}
				}
				const body = this.parser.parse(token.tokens);
				return `<div class="callout callout-${kind}"><div class="callout-title">${kind.toUpperCase()}</div><div class="callout-body">${body}</div></div>\n`;
			}
			return `<blockquote>${this.parser.parse(token.tokens)}</blockquote>\n`;
		}
	}
});

DOMPurify.addHook('afterSanitizeElements', (node) => {
	if (node.nodeName === 'INPUT' && 'type' in node && node.type !== 'checkbox') {
		node.parentNode?.removeChild(node);
	}
});

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
	if (node.nodeName === 'A') {
		const href = node.getAttribute('href') || '';
		if (href.startsWith('http://') || href.startsWith('https://')) {
			node.setAttribute('target', '_blank');
			node.setAttribute('rel', 'noopener noreferrer');
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
		ADD_ATTR: [
			'target',
			'class',
			'style',
			'type',
			'disabled',
			'checked',
			'rel',
			'aria-hidden',
			'viewBox',
			'd',
			'xmlns',
			'display',
			'encoding'
		],
		ADD_TAGS: [
			'span',
			'input',
			'math',
			'semantics',
			'mrow',
			'mi',
			'mo',
			'mn',
			'annotation',
			'svg',
			'path',
			'line'
		]
	});
}
