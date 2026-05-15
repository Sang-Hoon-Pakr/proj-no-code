import { Module } from '@nestjs/common';
import type { Pool } from 'pg';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PG_POOL } from '../config/database.module';

@Module({
  controllers: [AuthController],
  providers: [
    {
      provide: AuthService,
      useFactory: (pool: Pool): AuthService => {
        const secret = process.env.JWT_SECRET;
        if (!secret) {
          throw new Error('JWT_SECRET is required');
        }
        return new AuthService(pool, secret);
      },
      inject: [PG_POOL],
    },
  ],
  exports: [AuthService],
})
export class AuthModule {}
