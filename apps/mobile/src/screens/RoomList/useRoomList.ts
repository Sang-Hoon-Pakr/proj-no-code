import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { listMyRooms } from '../../api/rooms.api';
import { subscribeConnected, subscribeNewMessages } from '../../realtime/socket';
import { applyIncomingToRoomList } from '../../lib/rooms';
import type { RoomListItem } from '../../api/types';

export interface RoomListState {
  rooms: RoomListItem[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  retry: () => void;
}

export function useRoomList(): RoomListState {
  const [rooms, setRooms] = useState<RoomListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 소켓 핸들러에서 최신 목록 참조용 미러 (setState updater 안에서 side effect 금지).
  const roomsRef = useRef<RoomListItem[]>([]);

  useEffect(() => {
    roomsRef.current = rooms;
  }, [rooms]);

  const fetchRooms = useCallback(async (): Promise<void> => {
    try {
      const res = await listMyRooms();
      setRooms(res.rooms);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown');
    }
  }, []);

  // 최초 로드.
  useEffect(() => {
    void (async () => {
      setLoading(true);
      await fetchRooms();
      setLoading(false);
    })();
  }, [fetchRooms]);

  // 채팅방에서 돌아올 때 refetch — read:mark 반영된 unread 카운트 동기화.
  // (mobile-rules: 폴링 금지 — 사용자 액션 기반 갱신)
  useFocusEffect(
    useCallback(() => {
      void fetchRooms();
    }, [fetchRooms]),
  );

  // message:new 실시간 반영. 목록에 없는 방(새 방)이면 전체 refetch.
  useEffect(() => {
    return subscribeNewMessages((dto) => {
      const result = applyIncomingToRoomList(roomsRef.current, dto);
      if (result.applied) {
        setRooms(result.rooms);
      } else {
        void fetchRooms();
      }
    });
  }, [fetchRooms]);

  // 재연결 시 목록 재동기화 — 끊긴 사이 생긴 방/메시지 반영.
  useEffect(() => {
    return subscribeConnected(() => {
      void fetchRooms();
    });
  }, [fetchRooms]);

  const refresh = useCallback(async (): Promise<void> => {
    setRefreshing(true);
    await fetchRooms();
    setRefreshing(false);
  }, [fetchRooms]);

  const retry = useCallback((): void => {
    void fetchRooms();
  }, [fetchRooms]);

  return { rooms, loading, refreshing, error, refresh, retry };
}
