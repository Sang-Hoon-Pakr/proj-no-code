import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { RateLimitError } from '../common/errors';
import type { RateLimiter } from '../common/rate-limiter';

export const AUTH_RATE_LIMITER = Symbol('AUTH_RATE_LIMITER');

@Injectable()
export class AuthRateLimitGuard implements CanActivate {
  constructor(@Inject(AUTH_RATE_LIMITER) private readonly limiter: RateLimiter) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const ip = req.ip ?? 'unknown';
    const result = await this.limiter.check(`auth:${ip}`);
    if (!result.allowed) {
      throw new RateLimitError(result.retryAfterSec);
    }
    return true;
  }
}
