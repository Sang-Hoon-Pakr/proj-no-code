import { Module } from '@nestjs/common';
import type Redis from 'ioredis';
import type { Pool } from 'pg';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import {
  BRUTE_FORCE_PROTECTOR,
  type BruteForceProtector,
  RedisBruteForceProtector,
} from './brute-force';
import { AUTH_RATE_LIMITER, AuthRateLimitGuard } from './auth-rate-limit.guard';
import { JwtAuthGuard, JWT_SECRET_TOKEN } from '../common/jwt.guard';
import { RedisRateLimiter } from '../common/rate-limiter';
import { PG_POOL } from '../config/database.module';
import { REDIS_CLIENT } from '../config/redis.module';

// api-conventions.md: 인증 IP당 분당 10회
const AUTH_RATE_LIMIT = 10;
const AUTH_RATE_WINDOW_SEC = 60;

@Module({
  controllers: [AuthController],
  providers: [
    {
      provide: JWT_SECRET_TOKEN,
      useFactory: (): string => {
        const secret = process.env.JWT_SECRET;
        if (!secret) throw new Error('JWT_SECRET is required');
        return secret;
      },
    },
    {
      provide: BRUTE_FORCE_PROTECTOR,
      useFactory: (redis: Redis): BruteForceProtector => new RedisBruteForceProtector(redis),
      inject: [REDIS_CLIENT],
    },
    {
      provide: AUTH_RATE_LIMITER,
      useFactory: (redis: Redis) =>
        new RedisRateLimiter(redis, AUTH_RATE_LIMIT, AUTH_RATE_WINDOW_SEC),
      inject: [REDIS_CLIENT],
    },
    {
      provide: AuthService,
      useFactory: (pool: Pool, secret: string, brute: BruteForceProtector): AuthService =>
        new AuthService(pool, secret, brute),
      inject: [PG_POOL, JWT_SECRET_TOKEN, BRUTE_FORCE_PROTECTOR],
    },
    JwtAuthGuard,
    AuthRateLimitGuard,
  ],
  exports: [AuthService, JwtAuthGuard, JWT_SECRET_TOKEN],
})
export class AuthModule {}
