import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 32;

/** scrypt hash, format `scrypt$<saltHex>$<hashHex>`. node:crypto only. */
export function hashPassword(password: string): string {
	const salt = randomBytes(16).toString('hex');
	const hash = scryptSync(password, salt, KEYLEN, { N, r: R, p: P }).toString('hex');
	return `scrypt$${salt}$${hash}`;
}

/** Constant-time compare. Returns false on any malformed input. Never throws. */
export function verifyPassword(password: string, stored: string): boolean {
	const parts = stored.split('$');
	if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
	const [, salt, expectedHex] = parts;
	let actual: Buffer;
	let expected: Buffer;
	try {
		actual = scryptSync(password, salt, KEYLEN, { N, r: R, p: P });
		expected = Buffer.from(expectedHex, 'hex');
	} catch {
		return false;
	}
	return expected.length === actual.length && timingSafeEqual(expected, actual);
}
