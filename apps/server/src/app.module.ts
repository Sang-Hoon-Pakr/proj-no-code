import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller';
import { DatabaseModule } from './config/database.module';
import { RedisModule } from './config/redis.module';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './user/user.module';
import { BlockModule } from './block/block.module';
import { RoomModule } from './room/room.module';
import { MessageModule } from './message/message.module';

@Module({
  imports: [
    DatabaseModule,
    RedisModule,
    AuthModule,
    UserModule,
    BlockModule,
    RoomModule,
    MessageModule,
  ],
  controllers: [HealthController],
  providers: [],
})
export class AppModule {}
