import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller';
import { DatabaseModule } from './config/database.module';
import { AuthModule } from './auth/auth.module';
import { RoomModule } from './room/room.module';

@Module({
  imports: [DatabaseModule, AuthModule, RoomModule],
  controllers: [HealthController],
  providers: [],
})
export class AppModule {}
