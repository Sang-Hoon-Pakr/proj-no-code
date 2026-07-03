import type { RoomListItem, WsMessageDto } from '../api/types';

// message:new 수신 시 방 목록 in-place 갱신 — 미리보기/활동시각/unread + 맨 위로 이동.
// applied=false는 목록에 없는 방 (새 방 등) — 호출자가 전체 refetch로 처리.
// at-least-once 전제: 이미 반영된 seq 이하의 중복 수신은 무시.
export function applyIncomingToRoomList(
  rooms: RoomListItem[],
  dto: WsMessageDto,
): { rooms: RoomListItem[]; applied: boolean } {
  const idx = rooms.findIndex((r) => r.id === dto.roomId);
  if (idx === -1) return { rooms, applied: false };

  const target = rooms[idx];
  if (target.lastMessage && dto.seq <= target.lastMessage.seq) {
    return { rooms, applied: true };
  }

  const updated: RoomListItem = {
    ...target,
    lastActivityAt: dto.createdAt,
    unreadCount: target.unreadCount + 1,
    lastMessage: {
      id: dto.messageId,
      senderId: dto.senderId,
      content: dto.content,
      seq: dto.seq,
      createdAt: dto.createdAt,
    },
  };
  return { rooms: [updated, ...rooms.slice(0, idx), ...rooms.slice(idx + 1)], applied: true };
}
