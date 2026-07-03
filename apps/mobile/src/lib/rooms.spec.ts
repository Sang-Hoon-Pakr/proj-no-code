import { applyIncomingToRoomList } from './rooms';
import type { RoomListItem, WsMessageDto } from '../api/types';

function room(id: string, seq: number | null, unreadCount = 0): RoomListItem {
  return {
    id,
    type: 'direct',
    name: null,
    lastActivityAt: '2026-07-03T00:00:00.000Z',
    lastMessage:
      seq === null
        ? null
        : {
            id: `${id}-msg-${seq}`,
            senderId: 'user-2',
            content: 'old',
            seq,
            createdAt: '2026-07-03T00:00:00.000Z',
          },
    unreadCount,
    otherUser: null,
  };
}

function dto(roomId: string, seq: number): WsMessageDto {
  return {
    messageId: `msg-${seq}`,
    roomId,
    senderId: 'user-2',
    content: 'new message',
    seq,
    createdAt: '2026-07-03T01:00:00.000Z',
  };
}

describe('applyIncomingToRoomList', () => {
  it('수신한 방을 맨 위로 올리고 미리보기와 unread를 갱신한다', () => {
    const result = applyIncomingToRoomList([room('a', 1), room('b', 5, 2)], dto('b', 6));
    expect(result.rooms.map((r) => r.id)).toEqual(['b', 'a']);
    expect(result.rooms[0].lastMessage?.content).toBe('new message');
    expect(result.rooms[0].unreadCount).toBe(3);
  });

  it('이미 반영된 seq 이하의 중복 수신은 무시한다 (at-least-once)', () => {
    const rooms = [room('a', 5, 1)];
    const result = applyIncomingToRoomList(rooms, dto('a', 5));
    expect(result.rooms).toBe(rooms);
    expect(result.applied).toBe(true);
  });

  it('목록에 없는 방이면 applied=false를 반환한다', () => {
    const result = applyIncomingToRoomList([room('a', 1)], dto('unknown', 1));
    expect(result.applied).toBe(false);
  });

  it('lastMessage가 없던 방(빈 방)도 갱신된다', () => {
    const result = applyIncomingToRoomList([room('a', null)], dto('a', 1));
    expect(result.rooms[0].lastMessage?.seq).toBe(1);
    expect(result.rooms[0].unreadCount).toBe(1);
  });
});
