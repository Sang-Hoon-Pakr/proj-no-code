import { Module } from '@nestjs/common';
import type { Pool } from 'pg';
import { DeviceController } from './device.controller';
import { DeviceService } from './device.service';
import { PushService } from './push.service';
import { NoopPushProvider, PUSH_PROVIDER } from './push.provider';
import { PG_POOL } from '../config/database.module';
import { AuthModule } from '../auth/auth.module'; // JwtAuthGuard

@Module({
  imports: [AuthModule],
  controllers: [DeviceController],
  providers: [
    {
      provide: DeviceService,
      useFactory: (pool: Pool): DeviceService => new DeviceService(pool),
      inject: [PG_POOL],
    },
    {
      // 기본 provider: noop (FCM client 도입 전 placeholder).
      // 테스트는 overrideProvider로 InMemoryPushProvider 주입.
      provide: PUSH_PROVIDER,
      useFactory: (): NoopPushProvider => new NoopPushProvider(),
    },
    PushService,
  ],
  exports: [DeviceService, PushService, PUSH_PROVIDER],
})
export class PushModule {}
