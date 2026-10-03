import type { PageServerLoad } from './$types';

// Unlisted privacy: landing page does not query or leak other users' docs.
// Users see their own recent docs from their local shelf.
export const load: PageServerLoad = async () => {
	return {};
};
