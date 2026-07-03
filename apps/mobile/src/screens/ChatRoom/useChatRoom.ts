import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listRoomMessages } from '../../api/messages.api';
import { sendMessage, subscribeNewMessages } from '../../realtime/socket';
import { mergeMessagesDesc, toChatMessage } from '../../lib/messages';
import { uuidv7 } from '../../lib/uuid';
import { useAuth } from '../../store/auth';
import type { ChatMessage } from '../../api/types';

// security-rules.md: 메시지 길이 ≤ 5000자.
export const MAX_MESSAGE_LEN = 5000;

// 서버 확정(seq 부여) 전의 로컬 메시지. SQLite 도입 전까지 in-memory.
export interface PendingMessage {
  id: string; // messageId (UUIDv7) — 재시도에도 동일 (멱등성)
  roomId: string;
  content: string;
  createdAt: string;
  status: 'sending' | 'failed';
}

export type ChatListItem =
  | { kind: 'message'; message: ChatMessage }
  | { kind: 'pending'; pending: PendingMessage };

export interface ChatRoomState {
  items: ChatListItem[]; // 최신 먼저 (inverted FlatList용) — pending이 맨 앞
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  reload: () => void;
  loadOlder: () => void;
  send: (content: string) => void;
  retry: (messageId: string) => void;
}

export function useChatRoom(roomId: string): ChatRoomState {
  const myUserId = useAuth((s) => s.user?.id);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  // 커서/중복요청 가드는 렌더에 안 쓰이므로 ref로 관리.
  const nextBeforeRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);

  const reload = useCallback((): void => {
    void (async () => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      setLoading(true);
      try {
        const res = await listRoomMessages(roomId);
        setMessages(res.messages);
        setHasMore(res.hasMore);
        nextBeforeRef.current = res.nextBefore;
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'unknown');
      } finally {
        inFlightRef.current = false;
        setLoading(false);
      }
    })();
  }, [roomId]);

  const loadOlder = useCallback((): void => {
    void (async () => {
      const before = nextBeforeRef.current;
      if (inFlightRef.current || before === null) return;
      inFlightRef.current = true;
      setLoadingMore(true);
      try {
        const res = await listRoomMessages(roomId, { before });
        setMessages((prev) => mergeMessagesDesc(prev, res.messages));
        setHasMore(res.hasMore);
        nextBeforeRef.current = res.nextBefore;
      } catch (e) {
        // 이전 페이지 로드 실패는 화면 전체 에러로 승격하지 않는다.
        // 스크롤 시 onEndReached가 다시 트리거되어 자연 재시도.
        if (__DEV__) console.warn('[useChatRoom] loadOlder failed', e);
      } finally {
        inFlightRef.current = false;
        setLoadingMore(false);
      }
    })();
  }, [roomId]);

  useEffect(() => {
    reload();
  }, [reload]);

  // 실시간 수신 — at-least-once 전제, mergeMessagesDesc가 id로 dedupe.
  useEffect(() => {
    return subscribeNewMessages((dto) => {
      if (dto.roomId !== roomId) return;
      setMessages((prev) => mergeMessagesDesc(prev, [toChatMessage(dto)]));
    });
  }, [roomId]);

  // realtime-rules.md 전송 흐름: 즉시 표시(sending) → emit + ack 대기 →
  // ack 오면 확정 병합, 5초/에러 시 failed → 사용자 재시도.
  const deliver = useCallback(
    (messageId: string, content: string): void => {
      void (async () => {
        try {
          const ack = await sendMessage({ messageId, roomId, content });
          setPending((prev) => prev.filter((p) => p.id !== messageId));
          setMessages((prev) =>
            mergeMessagesDesc(prev, [
              {
                id: messageId,
                roomId,
                senderId: myUserId ?? '',
                content,
                seq: ack.seq,
                createdAt: ack.createdAt,
              },
            ]),
          );
        } catch (e) {
          if (__DEV__) console.warn('[useChatRoom] send failed', e);
          setPending((prev) =>
            prev.map((p) => (p.id === messageId ? { ...p, status: 'failed' } : p)),
          );
        }
      })();
    },
    [roomId, myUserId],
  );

  const send = useCallback(
    (content: string): void => {
      const trimmed = content.trim();
      if (!trimmed || trimmed.length > MAX_MESSAGE_LEN) return;
      const messageId = uuidv7();
      setPending((prev) => [
        {
          id: messageId,
          roomId,
          content: trimmed,
          createdAt: new Date().toISOString(),
          status: 'sending',
        },
        ...prev,
      ]);
      deliver(messageId, trimmed);
    },
    [roomId, deliver],
  );

  // 같은 messageId로 재전송 — 서버 dedupe로 중복 저장 없음.
  const retry = useCallback(
    (messageId: string): void => {
      const target = pending.find((p) => p.id === messageId);
      if (!target || target.status !== 'failed') return;
      setPending((prev) => prev.map((p) => (p.id === messageId ? { ...p, status: 'sending' } : p)));
      deliver(messageId, target.content);
    },
    [pending, deliver],
  );

  const items = useMemo<ChatListItem[]>(
    () => [
      ...pending.map((p): ChatListItem => ({ kind: 'pending', pending: p })),
      ...messages.map((m): ChatListItem => ({ kind: 'message', message: m })),
    ],
    [pending, messages],
  );

  return { items, loading, loadingMore, error, hasMore, reload, loadOlder, send, retry };
}
