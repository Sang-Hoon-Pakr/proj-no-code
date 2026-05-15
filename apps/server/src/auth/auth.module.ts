import { Module } from '@nestjs/common';
import type { Pool } from 'pg';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard, JWT_SECRET_TOKEN } from '../common/jwt.guard';
import { PG_POOL } from '../config/database.module';

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
      provide: AuthService,
      useFactory: (pool: Pool, secret: string): AuthService => new AuthService(pool, secret),
      inject: [PG_POOL, JWT_SECRET_TOKEN],
    },
    JwtAuthGuard,
  ],
  exports: [AuthService, JwtAuthGuard, JWT_SECRET_TOKEN],
})
export class AuthModule {}
