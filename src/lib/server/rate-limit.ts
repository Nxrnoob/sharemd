const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const LIMIT = 20;

const hits = new Map<string, number[]>();

/** In-memory 20 POSTs / hour / IP stub. Returns true when allowed. */
export function checkRateLimit(ip: string): { allowed: boolean; remaining: number } {
	const now = Date.now();
	const arr = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
	if (arr.length >= LIMIT) {
		hits.set(ip, arr);
		return { allowed: false, remaining: 0 };
	}
	arr.push(now);
	hits.set(ip, arr);
	return { allowed: true, remaining: LIMIT - arr.length };
}
