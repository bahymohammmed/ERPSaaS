import { describe, expect, it } from 'vitest';
import { RateLimiter } from './rate-limit';

describe('rate limiter', () => {
  it('blocks after the limit and resets with the window', () => {
    const limiter = new RateLimiter(2, 60_000);
    expect(limiter.take('ip', 0)).toBeNull();
    expect(limiter.take('ip', 1)).toBeNull();
    expect(limiter.take('ip', 2)).toBe(60);
    expect(limiter.take('other', 2)).toBeNull();
    expect(limiter.take('ip', 60_001)).toBeNull();
  });
});
