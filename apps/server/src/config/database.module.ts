import { Global, Module } from '@nestjs/common';
import { Pool } from 'pg';

export const PG_POOL = Symbol('PG_POOL');

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      useFactory: (): Pool => {
        const connectionString = process.env.DATABASE_URL;
        if (!connectionString) {
          // environment-rules.md: ConfigService.get default 금지 — fail-fast.
          throw new Error('DATABASE_URL is required');
        }
        return new Pool({ connectionString });
      },
    },
  ],
  exports: [PG_POOL],
})
export class DatabaseModule {}
