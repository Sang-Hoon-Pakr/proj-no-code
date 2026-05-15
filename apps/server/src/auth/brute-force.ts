import type Redis from 'ioredis';

export const BRUTE_FORCE_PROTECTOR = Symbol('BRUTE_FORCE_PROTECTOR');

export interface BruteForceProtector {
  isLockedOut(email: string): Promise<boolean>;
  recordFailure(email: string): Promise<void>;
  reset(email: string): Promise<void>;
}

// security-rules.md: 로그인 실패 5회 → 15분 잠금
export const DEFAULT_MAX_ATTEMPTS = 5;
export const DEFAULT_LOCK_WINDOW_SEC = 15 * 60;

export class RedisBruteForceProtector implements BruteForceProtector {
  constructor(
    private readonly redis: Redis,
    private readonly maxAttempts: number = DEFAULT_MAX_ATTEMPTS,
    private readonly windowSec: number = DEFAULT_LOCK_WINDOW_SEC,
  ) {}

  async isLockedOut(email: string): Promise<boolean> {
    const count = await this.redis.get(this.key(email));
    return Number(count ?? 0) >= this.maxAttempts;
  }

  async recordFailure(email: string): Promise<void> {
    const k = this.key(email);
    const count = await this.redis.incr(k);
    if (count === 1) await this.redis.expire(k, this.windowSec);
  }

  async reset(email: string): Promise<void> {
    await this.redis.del(this.key(email));
  }

  private key(email: string): string {
    return `auth:fail:${email.toLowerCase()}`;
  }
}
