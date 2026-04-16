/**
 * Simple TTL-based in-memory cache.
 * In serverless environments this resets on cold starts,
 * but it prevents hammering X during the same warm function instance.
 */

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

class TTLCache<T> {
  private store = new Map<string, CacheEntry<T>>();

  set(key: string, data: T, ttlMs: number): void {
    this.store.set(key, { data, expiresAt: Date.now() + ttlMs });
  }

  get(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.data;
  }

  has(key: string): boolean {
    return this.get(key) !== null;
  }

  delete(key: string): void {
    this.store.delete(key);
  }
}

// Shared caches — survive across requests in same warm function instance
export const resultCache = new TTLCache<unknown>(); // username → IntensityAudit, 5 min TTL
export const queryIdCache = new TTLCache<Record<string, string>>(); // "queryIds" → id map, 2hr TTL

export const RESULT_TTL = 5 * 60 * 1000;     // 5 minutes
export const QUERY_ID_TTL = 2 * 60 * 60 * 1000; // 2 hours
