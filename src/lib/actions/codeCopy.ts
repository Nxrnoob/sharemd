/**
 * Svelte action: adds a "Copy" button to every <pre> inside the node.
 * Works on server-rendered {@html} without re-parsing markdown,
 * so there is no hydration mismatch.
 */
export function codeCopy(node: HTMLElement) {
	const buttons: HTMLButtonElement[] = [];

	function addButton(pre: HTMLPreElement) {
		if (pre.querySelector('.code-copy-btn')) return;
		const btn = document.createElement('button');
		btn.type = 'button';
		btn.className = 'code-copy-btn';
		btn.textContent = 'Copy';
		btn.setAttribute('aria-label', 'Copy code block');
		btn.addEventListener('click', async () => {
			const code = pre.querySelector('code')?.innerText ?? pre.innerText;
			try {
				await navigator.clipboard.writeText(code);
				btn.textContent = 'Copied';
			} catch {
				btn.textContent = 'Failed';
			}
			setTimeout(() => (btn.textContent = 'Copy'), 1600);
		});
		pre.appendChild(btn);
		buttons.push(btn);
	}

	node.querySelectorAll('pre').forEach(addButton);

	const observer = new MutationObserver(() => {
		node.querySelectorAll('pre').forEach(addButton);
	});
	observer.observe(node, { childList: true, subtree: true });

	return {
		destroy() {
			observer.disconnect();
			buttons.forEach((b) => b.remove());
		}
	};
}
