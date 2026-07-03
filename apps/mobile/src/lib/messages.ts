import type { ChatMessage, WsMessageDto } from '../api/types';

// WS payload는 id가 `messageId` 필드 — REST ChatMessage 모양으로 정규화.
export function toChatMessage(dto: WsMessageDto): ChatMessage {
  return {
    id: dto.messageId,
    roomId: dto.roomId,
    senderId: dto.senderId,
    content: dto.content,
    seq: dto.seq,
    createdAt: dto.createdAt,
  };
}

// realtime-rules.md: at-least-once 전제 — 히스토리 페이지네이션이든 실시간 수신이든
// 어느 경로로 와도 messageId(id)로 dedupe. 기존 항목이 이긴다 (재수신 무시).
// 반환은 seq 내림차순 — inverted FlatList 데이터 순서 그대로 사용.
export function mergeMessagesDesc(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const m of existing) {
    byId.set(m.id, m);
  }
  for (const m of incoming) {
    if (!byId.has(m.id)) {
      byId.set(m.id, m);
    }
  }
  return [...byId.values()].sort((a, b) => b.seq - a.seq);
}
