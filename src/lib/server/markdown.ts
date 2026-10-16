import { Marked, type Tokens } from 'marked';
import { gfmHeadingId } from 'marked-gfm-heading-id';
import sanitizeHtml from 'sanitize-html';
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
				// Skip Shiki; the sanitizer below keeps class on pre/code.
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

/**
 * Sanitizer config — a faithful port of the previous DOMPurify allowlist.
 *
 * isomorphic-dompurify was removed because it pulls jsdom, which requires the
 * ESM-only @exodus/bytes. The Vercel Node runtime refuses to require() an ES
 * module, so every POST /api/docs died with ERR_REQUIRE_ESM (the Share button).
 * There is no all-CommonJS jsdom tree left to pin to — stepping the chain back
 * only moves the ESM boundary (@csstools/css-calc, then css-parser-algorithms)
 * — and bundling jsdom breaks the ESM server build on __dirname. sanitize-html
 * needs no DOM at all, so it loads cleanly on any runtime.
 *
 * sanitize-html is deliberately pinned to ~2.13.x: 2.14+ depends on the
 * ESM-only htmlparser2@12, which reintroduces this exact failure.
 */
type SanitizeOptions = NonNullable<Parameters<typeof sanitizeHtml>[1]>;

const SANITIZE_OPTIONS: SanitizeOptions = {
	// DOMPurify's default HTML allowlist, plus this app's ADD_TAGS
	// (span/input/math/semantics/mrow/mi/mo/mn/annotation/svg/path/line for
	// KaTeX MathML and mermaid SVG).
	allowedTags: [
		'a', 'abbr', 'b', 'blockquote', 'br', 'caption', 'cite', 'code', 'col',
		'colgroup', 'dd', 'del', 'details', 'div', 'dl', 'dt', 'em', 'figcaption',
		'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'ins', 'kbd',
		'li', 'mark', 'ol', 'p', 'pre', 'q', 'rp', 'rt', 'ruby', 's', 'samp',
		'section', 'small', 'span', 'strong', 'sub', 'summary', 'sup', 'table',
		'tbody', 'td', 'tfoot', 'th', 'thead', 'time', 'tr', 'u', 'ul', 'var', 'wbr',
		'span', 'input', 'math', 'semantics', 'mrow', 'mi', 'mo', 'mn',
		'annotation', 'svg', 'path', 'line'
	],
	allowedAttributes: {
		'*': [
			// this app's ADD_ATTR
			'target', 'class', 'style', 'type', 'disabled', 'checked', 'rel',
			'aria-hidden', 'viewBox', 'd', 'xmlns', 'display', 'encoding',
			// DOMPurify defaults the above tags rely on
			'href', 'src', 'alt', 'title', 'id', 'name', 'width', 'height',
			'colspan', 'rowspan', 'lang', 'dir', 'aria-label', 'aria-roledescription',
			'role', 'start', 'value'
		],
		// mermaid SVG presentation attributes
		svg: [
			'viewBox', 'xmlns', 'style', 'width', 'height', 'class', 'role',
			'aria-roledescription', 'aria-hidden', 'id', 'fill', 'stroke',
			'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'opacity',
			'transform', 'marker-end', 'marker-start', 'font-family', 'font-size'
		],
		path: ['d', 'fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'class', 'id'],
		line: ['x1', 'y1', 'x2', 'y2', 'stroke', 'stroke-width', 'class'],
		math: ['xmlns', 'display', 'class', 'style'],
		annotation: ['encoding'],
		input: ['type', 'disabled', 'checked', 'name', 'value'],
		a: ['href', 'target', 'rel', 'class', 'title'],
		img: ['src', 'alt', 'title', 'width', 'height', 'class', 'loading']
	},
	// SVG viewBox and MathML tags are case-sensitive; keep them intact.
	parser: { lowerCaseTags: false, lowerCaseAttributeNames: false },
	allowedSchemes: ['http', 'https', 'mailto'],
	allowProtocolRelative: false,
	allowedStyles: {
		'*': {
			color: [/^[#a-zA-Z0-9(),.\s-]+$/],
			'background-color': [/^[#a-zA-Z0-9(),.\s-]+$/],
			'text-align': [/^(left|right|center|justify)$/],
			'font-size': [/^[0-9]+(?:\.[0-9]+)?(?:px|em|rem|%)$/],
			'font-weight': [/^(normal|bold|[1-9]00)$/],
			'font-style': [/^(normal|italic|oblique)$/],
			'text-decoration': [/^[a-zA-Z\s-]+$/],
			'vertical-align': [/^[a-zA-Z0-9\s.-]+$/],
			width: [/^[0-9]+(?:\.[0-9]+)?(?:px|em|rem|%|auto)$/],
			height: [/^[0-9]+(?:\.[0-9]+)?(?:px|em|rem|%|auto)$/],
			display: [/^(inline|inline-block|block|inline-flex|flex)$/]
		}
	},
	// was the afterSanitizeElements hook: drop every input except checkboxes
	exclusiveFilter: (frame) => frame.tag === 'input' && frame.attribs.type !== 'checkbox',
	// was the afterSanitizeAttributes hook: external links open safely
	transformTags: {
		a: (tagName, attribs) => {
			const href = attribs.href || '';
			if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('//')) {
				return { tagName, attribs: { ...attribs, target: '_blank', rel: 'noopener noreferrer' } };
			}
			return { tagName, attribs };
		}
	}
};

/**
 * Server-only: pre-render markdown to sanitized HTML at POST time.
 * Stored in `documents.html`; view routes must NOT re-parse.
 */
export async function renderMarkdown(raw: string): Promise<string> {
	const dirty = (await marked.parse(raw, { async: true })) as string;
	return sanitizeHtml(dirty, SANITIZE_OPTIONS);
}
