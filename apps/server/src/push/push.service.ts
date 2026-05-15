import { Inject, Logger } from '@nestjs/common';
import { DeviceService } from './device.service';
import { PUSH_PROVIDER, type PushPayload, type PushProvider } from './push.provider';

export class PushService {
  private readonly logger = new Logger(PushService.name);

  constructor(
    @Inject(PUSH_PROVIDER) private readonly provider: PushProvider,
    private readonly deviceService: DeviceService,
  ) {}

  // best-effort fan-out. push 실패가 호출자 흐름 막지 않음.
  async sendToUser(
    userId: string,
    payload: PushPayload,
  ): Promise<{ sent: number; failed: number }> {
    const devices = await this.deviceService.listActiveForUser(userId);
    let sent = 0;
    let failed = 0;

    for (const d of devices) {
      if (!d.pushToken) continue;
      try {
        const result = await this.provider.send(d.pushToken, payload);
        if (result.ok) sent++;
        else {
          failed++;
          // security-rules.md: 메시지 본문 로깅 금지 — token prefix + error만.
          this.logger.warn(`push fail device=${d.id} error=${result.error}`);
        }
      } catch (e) {
        failed++;
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.warn(`push throw device=${d.id} ${msg}`);
      }
    }

    return { sent, failed };
  }
}
