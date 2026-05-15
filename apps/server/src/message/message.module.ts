import { Module } from '@nestjs/common';
import type { Pool } from 'pg';
import { MessageService } from './message.service';
import { MessageGateway } from './message.gateway';
import { PG_POOL } from '../config/database.module';
import { AuthModule } from '../auth/auth.module'; // JWT_SECRET_TOKEN
import { RoomModule } from '../room/room.module'; // RoomService
import { RoomService } from '../room/room.service';

@Module({
  imports: [AuthModule, RoomModule],
  providers: [
    {
      provide: MessageService,
      useFactory: (pool: Pool, roomService: RoomService): MessageService =>
        new MessageService(pool, roomService),
      inject: [PG_POOL, RoomService],
    },
    MessageGateway,
  ],
  exports: [MessageService],
})
export class MessageModule {}
