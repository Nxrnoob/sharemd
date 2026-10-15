/**
 * Link-gate validation shared by every endpoint that can set them.
 *
 * Slug and expiry rules appear in doc creation, bundle creation, and doc setting
 * edits, so they live here once: an allowlist that quietly diverges between
 * endpoints is a security bug waiting to happen.
 */

/** Slugs are lowercase alphanumerics and dashes, 3 to 32 long. */
export const SLUG_RE = /^[a-z0-9-]{3,32}$/;

/** Expiry is a fixed menu, not a free-form duration. */
export const EXPIRY_ALLOWLIST = [3600, 86400, 604800, 2592000];