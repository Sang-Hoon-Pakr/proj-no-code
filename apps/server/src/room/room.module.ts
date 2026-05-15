import { Module } from '@nestjs/common';
import type { Pool } from 'pg';
import { RoomController } from './room.controller';
import { RoomService } from './room.service';
import { PG_POOL } from '../config/database.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule], // JwtAuthGuard 제공받음
  controllers: [RoomController],
  providers: [
    {
      provide: RoomService,
      useFactory: (pool: Pool): RoomService => new RoomService(pool),
      inject: [PG_POOL],
    },
  ],
  exports: [RoomService],
})
export class RoomModule {}
