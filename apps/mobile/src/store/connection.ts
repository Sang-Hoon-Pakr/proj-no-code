import { create } from 'zustand';

// realtime-rules.md: 5회 실패하면 사용자에게 "연결 끊김" 배너 표시.
const FAILURE_BANNER_THRESHOLD = 5;

export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected';

interface ConnectionState {
  status: ConnectionStatus;
  consecutiveFailures: number;
  showBanner: boolean;
  setConnected: () => void;
  setConnecting: () => void;
  setDisconnected: () => void;
  recordFailure: () => void;
}

export const useConnection = create<ConnectionState>((set) => ({
  status: 'disconnected',
  consecutiveFailures: 0,
  showBanner: false,

  setConnected: () => set({ status: 'connected', consecutiveFailures: 0, showBanner: false }),
  setConnecting: () => set({ status: 'connecting' }),
  setDisconnected: () => set({ status: 'disconnected' }),
  recordFailure: () =>
    set((s) => {
      const consecutiveFailures = s.consecutiveFailures + 1;
      return {
        consecutiveFailures,
        showBanner: consecutiveFailures >= FAILURE_BANNER_THRESHOLD,
      };
    }),
}));
