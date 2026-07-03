import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useAuth } from '../store/auth';
import { connectSocket, disconnectSocket } from './socket';

// mobile-rules.md: 백그라운드에서 WebSocket 유지 시도 금지 — 진입 시 정리,
// foreground 복귀 시 재연결. 로그인 상태에서만 연결.
export function useSocketLifecycle(): void {
  const authStatus = useAuth((s) => s.status);

  useEffect(() => {
    if (authStatus !== 'authenticated') {
      disconnectSocket();
      return;
    }

    connectSocket();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        connectSocket();
      } else if (state === 'background') {
        disconnectSocket();
      }
    });

    return () => {
      subscription.remove();
      disconnectSocket();
    };
  }, [authStatus]);
}
