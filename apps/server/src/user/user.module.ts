import { Module } from '@nestjs/common';
import type { Pool } from 'pg';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { PG_POOL } from '../config/database.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule], // JwtAuthGuard
  controllers: [UserController],
  providers: [
    {
      provide: UserService,
      useFactory: (pool: Pool): UserService => new UserService(pool),
      inject: [PG_POOL],
    },
  ],
  exports: [UserService],
})
export class UserModule {}
