import { useCallback, useEffect, useRef, useState } from 'react';
import { listRoomMessages } from '../../api/messages.api';
import { mergeMessagesDesc } from '../../lib/messages';
import type { ChatMessage } from '../../api/types';

export interface ChatRoomState {
  messages: ChatMessage[]; // seq 내림차순 (inverted FlatList용)
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  reload: () => void;
  loadOlder: () => void;
}

export function useChatRoom(roomId: string): ChatRoomState {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
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

  return { messages, loading, loadingMore, error, hasMore, reload, loadOlder };
}
