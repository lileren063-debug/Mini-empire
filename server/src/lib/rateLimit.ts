/**
 * In-memory fixed-window rate limiter. Good enough for a single server instance; swap for a
 * Redis-backed limiter when running several instances (documented in docs/DEPLOYMENT.md).
 */
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();
  constructor(private now: () => number) {}

  /** Returns true when the request is allowed. */
  check(key: string, limit: number, windowMs: number): boolean {
    const t = this.now();
    const cur = this.hits.get(key);
    if (!cur || cur.resetAt <= t) {
      this.hits.set(key, { count: 1, resetAt: t + windowMs });
      if (this.hits.size > 50_000) this.gc(t);
      return true;
    }
    cur.count++;
    return cur.count <= limit;
  }

  private gc(t: number) {
    for (const [k, v] of this.hits) if (v.resetAt <= t) this.hits.delete(k);
  }
}
