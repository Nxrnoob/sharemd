/**
 * Editor theme pack for ShareMD.
 *
 * Themes are applied by setting `document.documentElement.dataset.theme`
 * (plus the `dark` class for dark themes, which also drives the stored
 * Shiki github-light/dark code vars). All UI colors flow through CSS
 * variables remapped per `[data-theme]` in layout.css, so switching
 * needs no reload and no re-highlight.
 */

export interface ThemeTokens {
	bg: string;
	surface: string;
	text: string;
	muted: string;
	border: string;
	accent: string;
	accentDeep: string;
}

export interface ShareMdTheme {
	id: string;
	label: string;
	/** false only for light themes (drives the `dark` class + code vars) */
	dark: boolean;
	tokens: ThemeTokens;
}

export const STORAGE_KEY = 'sharemd-theme';
export const DEFAULT_THEME_ID = 'monochrome' as const;

export const themes: ShareMdTheme[] = [
	{
		id: 'monochrome',
		label: 'Monochrome',
		dark: true,
		tokens: {
			bg: '#000000',
			surface: '#111214',
			text: '#f5f5f5',
			muted: '#a3a3a3',
			border: '#262626',
			accent: '#ffffff',
			accentDeep: '#d4d4d4'
		}
	},
	{
		id: 'nxr',
		label: "Nxr's theme",
		dark: true,
		tokens: {
			bg: '#000000',
			surface: '#0b0b10',
			text: '#f4f2fa',
			muted: '#9c93b0',
			border: '#1e1b2e',
			accent: '#cc00ff',
			accentDeep: '#9900cc'
		}
	},
	{
		id: 'dracula',
		label: 'Dracula',
		dark: true,
		tokens: {
			bg: '#282a36',
			surface: '#343746',
			text: '#f8f8f2',
			muted: '#9aa0b8',
			border: '#44475a',
			accent: '#bd93f9',
			accentDeep: '#8b5cf6'
		}
	},
	{
		id: 'catppuccin-mocha',
		label: 'Catppuccin Mocha',
		dark: true,
		tokens: {
			bg: '#1e1e2e',
			surface: '#313244',
			text: '#cdd6f4',
			muted: '#9399b2',
			border: '#45475a',
			accent: '#89b4fa',
			accentDeep: '#5b7ec4'
		}
	},
	{
		id: 'catppuccin-latte',
		label: 'Catppuccin Latte',
		dark: false,
		tokens: {
			bg: '#eff1f5',
			surface: '#ffffff',
			text: '#4c4f69',
			muted: '#8c8fa1',
			border: '#ccd0da',
			accent: '#1e66f5',
			accentDeep: '#174fb8'
		}
	},
	{
		id: 'nord',
		label: 'Nord',
		dark: true,
		tokens: {
			bg: '#2e3440',
			surface: '#3b4252',
			text: '#eceff4',
			muted: '#9aa3b2',
			border: '#4c566a',
			accent: '#88c0d0',
			accentDeep: '#5e81ac'
		}
	},
	{
		id: 'github-dark',
		label: 'GitHub Dark',
		dark: true,
		tokens: {
			bg: '#0d1117',
			surface: '#161b22',
			text: '#e6edf3',
			muted: '#9198a1',
			border: '#30363d',
			accent: '#4493f8',
			accentDeep: '#1f6feb'
		}
	},
	{
		id: 'monokai',
		label: 'Monokai',
		dark: true,
		tokens: {
			bg: '#272822',
			surface: '#36372f',
			text: '#f8f8f2',
			muted: '#a6a28f',
			border: '#49483e',
			accent: '#a6e22e',
			accentDeep: '#7da61b'
		}
	},
	{
		id: 'tokyo-night',
		label: 'Tokyo Night',
		dark: true,
		tokens: {
			bg: '#1a1b26',
			surface: '#24283b',
			text: '#c0caf5',
			muted: '#8b91b5',
			border: '#414868',
			accent: '#7aa2f7',
			accentDeep: '#3d59a1'
		}
	},
	{
		id: 'gruvbox',
		label: 'Gruvbox Dark',
		dark: true,
		tokens: {
			bg: '#282828',
			surface: '#3c3836',
			text: '#ebdbb2',
			muted: '#a89984',
			border: '#504945',
			accent: '#fabd2f',
			accentDeep: '#d79921'
		}
	}
];

export type ThemeId = (typeof themes)[number]['id'];

export function getTheme(id: string | null | undefined): ShareMdTheme {
	return themes.find((t) => t.id === id) ?? themes[0];
}

export function isThemeId(value: unknown): value is ThemeId {
	return typeof value === 'string' && themes.some((t) => t.id === value);
}

/**
 * Read a `?theme=` URL param, validated against known ids.
 * Returns null for missing/invalid values.
 */
export function getThemeFromUrl(search: string): ThemeId | null {
	try {
		const query = search.split('#')[0];
		const v = new URLSearchParams(query).get('theme');
		return isThemeId(v) ? v : null;
	} catch {
		return null;
	}
}

/**
 * Set (or replace) the `?theme=` param on a path, preserving any other
 * params and hash. Pure string surgery, safe on server and client.
 */
export function buildThemedUrl(path: string, themeId: ThemeId): string {
	const hashIndex = path.indexOf('#');
	const hash = hashIndex >= 0 ? path.slice(hashIndex) : '';
	const withoutHash = hashIndex >= 0 ? path.slice(0, hashIndex) : path;
	const qIndex = withoutHash.indexOf('?');
	const base = qIndex >= 0 ? withoutHash.slice(0, qIndex) : withoutHash;
	const params = new URLSearchParams(qIndex >= 0 ? withoutHash.slice(qIndex + 1) : '');
	params.set('theme', themeId);
	return `${base}?${params.toString()}${hash}`;
}

/**
 * Apply a theme without reload: dataset + `dark` class (drives Shiki
 * code vars) + color-scheme + theme-color meta + persistence.
 * No-op on the server.
 */
export function applyTheme(id: string): ShareMdTheme {
	const theme = getTheme(isThemeId(id) ? id : DEFAULT_THEME_ID);
	paintTheme(theme);
	if (typeof document === 'undefined') return theme;
	try {
		localStorage.setItem(STORAGE_KEY, theme.id);
	} catch {
		/* private mode etc: theme still applies for this session */
	}
	return theme;
}

/**
 * Session-only override (e.g. from a shared `?theme=` link): paints the
 * theme exactly like applyTheme but does NOT touch localStorage, so the
 * viewer's own default stays untouched.
 */
export function applySessionTheme(id: string): ShareMdTheme {
	const theme = getTheme(isThemeId(id) ? id : DEFAULT_THEME_ID);
	paintTheme(theme);
	return theme;
}

function paintTheme(theme: ShareMdTheme): void {
	if (typeof document === 'undefined') return;
	const root = document.documentElement;
	root.dataset.theme = theme.id;
	root.classList.toggle('dark', theme.dark);
	root.style.colorScheme = theme.dark ? 'dark' : 'light';
	const meta = document.querySelector('meta[name="theme-color"]');
	if (meta) meta.setAttribute('content', theme.tokens.bg);
}
