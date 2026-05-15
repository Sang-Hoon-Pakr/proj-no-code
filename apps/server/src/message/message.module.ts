import { Module } from '@nestjs/common';
import type { Pool } from 'pg';
import { MessageService } from './message.service';
import { MessageGateway } from './message.gateway';
import { MessageController } from './message.controller';
import { PG_POOL } from '../config/database.module';
import { AuthModule } from '../auth/auth.module'; // JWT_SECRET_TOKEN
import { RoomModule } from '../room/room.module'; // RoomService
import { RoomService } from '../room/room.service';
import { BlockModule } from '../block/block.module';
import { BlockService } from '../block/block.service';
import { PushModule } from '../push/push.module';

@Module({
  imports: [AuthModule, RoomModule, BlockModule, PushModule],
  controllers: [MessageController],
  providers: [
    {
      provide: MessageService,
      useFactory: (
        pool: Pool,
        roomService: RoomService,
        blockService: BlockService,
      ): MessageService => new MessageService(pool, roomService, blockService),
      inject: [PG_POOL, RoomService, BlockService],
    },
    MessageGateway,
  ],
  exports: [MessageService],
})
export class MessageModule {}
