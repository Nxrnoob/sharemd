/**
 * Shared clipboard helper for ShareMD.
 *
 * `navigator.clipboard.writeText` requires a secure context, so it throws
 * on plain-HTTP deploys. This tries the modern API first, then falls back
 * to the legacy hidden-textarea + `document.execCommand('copy')` path
 * (which works on HTTP), and reports success as a boolean. Client-only.
 */
export async function copyText(text: string): Promise<boolean> {
	try {
		if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(text);
			return true;
		}
		throw new Error('clipboard API unavailable');
	} catch {
		/* fall through to legacy path */
	}

	try {
		if (typeof document === 'undefined') return false;
		const ta = document.createElement('textarea');
		ta.value = text;
		ta.setAttribute('readonly', '');
		ta.style.position = 'fixed';
		ta.style.top = '-9999px';
		ta.style.left = '-9999px';
		ta.style.opacity = '0';
		document.body.appendChild(ta);
		ta.focus({ preventScroll: true });
		ta.select();
		ta.setSelectionRange(0, ta.value.length);
		const ok = document.execCommand('copy');
		ta.remove();
		return ok;
	} catch {
		return false;
	}
}
