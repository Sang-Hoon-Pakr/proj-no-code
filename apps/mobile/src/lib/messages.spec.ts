import { mergeMessagesDesc } from './messages';
import type { ChatMessage } from '../api/types';

function msg(id: string, seq: number, content = 'x'): ChatMessage {
  return {
    id,
    roomId: 'room-1',
    senderId: 'user-1',
    content,
    seq,
    createdAt: '2026-07-03T00:00:00.000Z',
  };
}

describe('mergeMessagesDesc', () => {
  it('겹치는 페이지를 병합해도 같은 id는 1건만 남는다 (at-least-once dedupe)', () => {
    const existing = [msg('c', 3), msg('b', 2)];
    const incoming = [msg('b', 2), msg('a', 1)];
    const merged = mergeMessagesDesc(existing, incoming);
    expect(merged.map((m) => m.id)).toEqual(['c', 'b', 'a']);
  });

  it('결과는 항상 seq 내림차순으로 정렬된다', () => {
    const merged = mergeMessagesDesc([msg('a', 1)], [msg('c', 3), msg('b', 2)]);
    expect(merged.map((m) => m.seq)).toEqual([3, 2, 1]);
  });

  it('id 충돌 시 기존 메시지가 유지된다 (재수신 무시)', () => {
    const merged = mergeMessagesDesc([msg('a', 1, 'original')], [msg('a', 1, 'duplicate')]);
    expect(merged).toHaveLength(1);
    expect(merged[0].content).toBe('original');
  });

  it('빈 입력끼리 병합하면 빈 배열을 반환한다', () => {
    expect(mergeMessagesDesc([], [])).toEqual([]);
  });
});
