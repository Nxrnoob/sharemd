import { eq, lt, sql } from 'drizzle-orm';
import { db } from './db';
import { rateHits } from './db/schema';

const WINDOW_MS = 60 * 60 * 1000; // 1 hour

export type RateLimitScope = 'create' | 'unlock' | 'edit' | 'contribute' | 'manage';

const DEFAULT_LIMITS: Record<RateLimitScope, number> = {
	create: 30,
	unlock: 60,
	edit: 120,
	contribute: 60,
	manage: 120
};

/**
 * Serverless-safe atomic rate limiter with scoped operation buckets,
 * backed by the rate_hits table.
 */
export async function checkRateLimit(
	ip: string,
	scope: RateLimitScope = 'create',
	customLimit?: number
): Promise<{ allowed: boolean; remaining: number }> {
	const limit = customLimit ?? DEFAULT_LIMITS[scope] ?? 30;
	const key = `${ip}:${scope}`;
	const now = Date.now();
	const cutoff = now - WINDOW_MS;

	try {
		await db.delete(rateHits).where(lt(rateHits.windowStart, cutoff)).run();
	} catch {
		// Best-effort pruning; failure must not block the request
	}

	const row = await db.select().from(rateHits).where(eq(rateHits.ip, key)).get();

	if (!row || row.windowStart <= cutoff) {
		await db
			.insert(rateHits)
			.values({ ip: key, windowStart: now, count: 1 })
			.onConflictDoUpdate({ target: rateHits.ip, set: { windowStart: now, count: 1 } })
			.run();
		return { allowed: true, remaining: limit - 1 };
	}

	if (row.count >= limit) {
		return { allowed: false, remaining: 0 };
	}

	// Atomic SQL update with guard condition against concurrency races
	const res = await db.run(
		sql`UPDATE rate_hits SET count = count + 1 WHERE ip = ${key} AND count < ${limit}`
	);

	if (res.rowsAffected === 0) {
		return { allowed: false, remaining: 0 };
	}

	return { allowed: true, remaining: Math.max(0, limit - (row.count + 1)) };
}
