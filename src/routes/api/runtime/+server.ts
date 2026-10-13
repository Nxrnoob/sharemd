import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * TEMPORARY diagnostic. Reports the deployed runtime so we can settle whether
 * the ERR_REQUIRE_ESM comes from a runtime too old for require(esm) (needs
 * Node >= 22.12) or from something else entirely.
 *
 * DELETE once the runtime question is resolved.
 */
export const GET: RequestHandler = async () => {
	const out: Record<string, unknown> = {
		node: process.version,
		// The exact flag behind this bug. False => require() of an ESM package
		// throws ERR_REQUIRE_ESM, which is what we are seeing.
		requireModule: process.features.require_module,
		arch: process.arch,
		platform: process.platform
	};

	// Live proof of the actual failing operation, via createRequire so the
	// result does not depend on this file's own module system.
	try {
		const { createRequire } = await import('node:module');
		const req = createRequire(import.meta.url);
		req('isomorphic-dompurify');
		out.requireDomPurify = 'ok';
	} catch (e) {
		out.requireDomPurify = 'FAILED';
		out.requireDomPurifyError = (e as Error).message.split('\n')[0];
	}

	return json(out);
};
