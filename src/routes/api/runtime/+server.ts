import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * TEMPORARY diagnostic. Reports the deployed runtime.
 *
 * Originally used to settle whether the ERR_REQUIRE_ESM came from a runtime
 * too old for require(esm). That question is resolved: isomorphic-dompurify
 * (and therefore jsdom) has been removed from the server bundle entirely, so
 * nothing on the request path requires an ES module any more.
 *
 * This endpoint is now just runtime telemetry — DELETE when convenient.
 */
export const GET: RequestHandler = async () => {
	return json({
		node: process.version,
		// require(esm) support. Irrelevant to us now that no ESM is require()d,
		// but kept because it explains any third-party package that reintroduces it.
		requireModule: process.features.require_module,
		arch: process.arch,
		platform: process.platform
	});
};
