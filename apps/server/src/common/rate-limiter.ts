import type Redis from 'ioredis';

export interface RateLimiterResult {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
}

export interface RateLimiter {
  check(key: string): Promise<RateLimiterResult>;
}

// api-conventions.md: 인증 API IP당 분당 10회 (기본값)
export class RedisRateLimiter implements RateLimiter {
  constructor(
    private readonly redis: Redis,
    private readonly limit: number,
    private readonly windowSec: number,
  ) {}

  async check(key: string): Promise<RateLimiterResult> {
    const k = `rate:${key}`;
    const count = await this.redis.incr(k);
    if (count === 1) await this.redis.expire(k, this.windowSec);
    const ttl = await this.redis.ttl(k);
    return {
      allowed: count <= this.limit,
      remaining: Math.max(0, this.limit - count),
      retryAfterSec: ttl > 0 ? ttl : this.windowSec,
    };
  }
}
