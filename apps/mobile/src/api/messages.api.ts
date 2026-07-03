import { api } from './client';
import type { MessageListResponse } from './types';

// 서버는 seq 기반 역방향 커서 (before보다 작은 seq를 최신순으로 반환).
export async function listRoomMessages(
  roomId: string,
  opts: { before?: number; limit?: number } = {},
): Promise<MessageListResponse> {
  return api<MessageListResponse>(`/rooms/${roomId}/messages`, {
    query: { before: opts.before, limit: opts.limit },
  });
}
