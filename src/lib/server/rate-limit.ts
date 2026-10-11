import { eq, lt } from 'drizzle-orm';
import { db } from './db';
import { rateHits } from './db/schema';

const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const LIMIT = 20;

/**
 * Serverless-safe 20 POSTs / hour / IP limiter, backed by the `rate_hits`
 * table (Turso in prod, local file in dev — wherever `db` points).
 * Rolling window anchored at the first hit, same semantics as the old
 * in-memory Map. Prunes expired buckets on every write.
 */
export async function checkRateLimit(ip: string): Promise<{ allowed: boolean; remaining: number }> {
	const now = Date.now();
	const cutoff = now - WINDOW_MS;

	// Prune-on-write: drop buckets whose window already expired.
	await db.delete(rateHits).where(lt(rateHits.windowStart, cutoff)).run();

	const row = await db.select().from(rateHits).where(eq(rateHits.ip, ip)).get();

	if (!row || row.windowStart <= cutoff) {
		// New window (or first hit ever). Upsert so concurrent cold starts
		// cannot crash on the PRIMARY KEY.
		await db
			.insert(rateHits)
			.values({ ip, windowStart: now, count: 1 })
			.onConflictDoUpdate({ target: rateHits.ip, set: { windowStart: now, count: 1 } })
			.run();
		return { allowed: true, remaining: LIMIT - 1 };
	}

	if (row.count >= LIMIT) {
		return { allowed: false, remaining: 0 };
	}

	const next = row.count + 1;
	await db.update(rateHits).set({ count: next }).where(eq(rateHits.ip, ip)).run();
	return { allowed: true, remaining: LIMIT - next };
}
