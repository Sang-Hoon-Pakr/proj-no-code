import { Global, Module } from '@nestjs/common';
import Redis from 'ioredis';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: (): Redis => {
        const url = process.env.REDIS_URL;
        if (!url) {
          // environment-rules.md: ConfigService default 금지 — fail-fast.
          throw new Error('REDIS_URL is required');
        }
        return new Redis(url, { lazyConnect: false });
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
