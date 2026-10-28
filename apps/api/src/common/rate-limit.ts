import type { NextFunction, Request, Response } from 'express';

/** Fixed-window counter per key, held in process memory (one API instance; use a shared store when scaling out). */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Returns seconds to wait when the key is over its limit, otherwise null. */
  take(key: string, now = Date.now()): number | null {
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      if (this.hits.size > 50_000) this.prune(now);
      return null;
    }
    entry.count++;
    return entry.count > this.limit ? Math.ceil((entry.resetAt - now) / 1000) : null;
  }

  private prune(now: number): void {
    for (const [key, entry] of this.hits) if (entry.resetAt <= now) this.hits.delete(key);
  }
}

const AUTH_PATHS = /^\/api\/auth\/(login|signup|mfa\/)/;

/**
 * Brute-force protection on authentication (default 20 requests per minute per IP) and a general
 * ceiling on everything else (default 1200 per minute per IP). RATE_LIMIT=off disables both.
 */
export const rateLimitMiddleware = () => {
  const auth = new RateLimiter(Number(process.env.RATE_LIMIT_AUTH ?? 20), 60_000);
  const general = new RateLimiter(Number(process.env.RATE_LIMIT_GENERAL ?? 1200), 60_000);
  // Behind a trusted edge (the Cloudflare Worker) the client address arrives in this header.
  const ipHeader = process.env.CLIENT_IP_HEADER?.toLowerCase();
  return (req: Request, res: Response, next: NextFunction) => {
    if (process.env.RATE_LIMIT === 'off') return next();
    const forwarded = ipHeader ? req.headers[ipHeader] : undefined;
    const ip = (typeof forwarded === 'string' && forwarded) || req.ip || 'unknown';
    const wait = AUTH_PATHS.test(req.path) ? auth.take(`auth:${ip}`) : general.take(`api:${ip}`);
    if (wait === null) return next();
    res.setHeader('Retry-After', String(wait));
    res.status(429).json({ error: { code: 'RATE_LIMITED', params: { seconds: wait } } });
  };
};
