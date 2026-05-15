import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller';
import { DatabaseModule } from './config/database.module';
import { AuthModule } from './auth/auth.module';
import { RoomModule } from './room/room.module';
import { MessageModule } from './message/message.module';

@Module({
  imports: [DatabaseModule, AuthModule, RoomModule, MessageModule],
  controllers: [HealthController],
  providers: [],
})
export class AppModule {}
