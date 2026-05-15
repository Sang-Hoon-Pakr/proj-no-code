import { Module } from '@nestjs/common';
import type { Pool } from 'pg';
import { BlockController } from './block.controller';
import { BlockService } from './block.service';
import { PG_POOL } from '../config/database.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule], // JwtAuthGuard
  controllers: [BlockController],
  providers: [
    {
      provide: BlockService,
      useFactory: (pool: Pool): BlockService => new BlockService(pool),
      inject: [PG_POOL],
    },
  ],
  exports: [BlockService],
})
export class BlockModule {}
