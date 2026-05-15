import { Logger } from '@nestjs/common';

export interface PushPayload {
  notification: { title: string; body: string };
  // security-rules.md: roomId, messageId, senderId만. content 금지.
  data: Record<string, string>;
}

export interface PushSendResult {
  ok: boolean;
  error?: string;
}

export interface PushProvider {
  send(token: string, payload: PushPayload): Promise<PushSendResult>;
}

export const PUSH_PROVIDER = Symbol('PUSH_PROVIDER');

// 테스트용 — 전송 호출을 기록만 함.
export class InMemoryPushProvider implements PushProvider {
  public readonly sent: Array<{ token: string; payload: PushPayload }> = [];

  async send(token: string, payload: PushPayload): Promise<PushSendResult> {
    this.sent.push({ token, payload });
    return { ok: true };
  }

  reset(): void {
    this.sent.length = 0;
  }
}

// 개발/초기 프로덕션 placeholder. FCM client 도입 전까지 로그만.
export class NoopPushProvider implements PushProvider {
  private readonly logger = new Logger('NoopPushProvider');

  async send(token: string, payload: PushPayload): Promise<PushSendResult> {
    this.logger.log(
      `[noop] push token=${token.slice(0, 8)}... title=${payload.notification.title}`,
    );
    return { ok: true };
  }
}
