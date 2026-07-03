import { io, type Socket } from 'socket.io-client';
import { config } from '../config';
import { getAccessToken, refreshTokens } from '../api/client';
import { useConnection } from '../store/connection';
import type { WsMessageDto } from '../api/types';

// realtime-rules.md: exponential backoff 1s → 30s, jitter ±20%. 즉시 재연결 금지.
const RECONNECT_DELAY_MS = 1000;
const RECONNECT_DELAY_MAX_MS = 30_000;
const JITTER_FACTOR = 0.2;
// realtime-rules.md: 5초 안에 ack 없으면 failed 처리.
const SEND_ACK_TIMEOUT_MS = 5000;

type NewMessageHandler = (dto: WsMessageDto) => void;

interface AckError {
  ok: false;
  error: { code: string; message: string };
}
interface SendAckOk {
  ok: true;
  data: { messageId: string; seq: number; createdAt: string };
}
type SendAck = SendAckOk | AckError;

export interface SendResult {
  messageId: string;
  seq: number;
  createdAt: string;
}

let socket: Socket | null = null;
const newMessageHandlers = new Set<NewMessageHandler>();

export function connectSocket(): void {
  if (socket) {
    if (!socket.connected) {
      useConnection.getState().setConnecting();
      socket.connect();
    }
    return;
  }

  useConnection.getState().setConnecting();
  socket = io(config.wsUrl, {
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: RECONNECT_DELAY_MS,
    reconnectionDelayMax: RECONNECT_DELAY_MAX_MS,
    randomizationFactor: JITTER_FACTOR,
    // 매 연결 시도마다 최신 access token을 다시 읽는다 (TTL 15분 — 고정 auth 객체 금지).
    auth: (cb) => {
      void getAccessToken().then((token) => cb({ token: token ?? '' }));
    },
  });

  socket.on('connect', () => {
    useConnection.getState().setConnected();
  });

  socket.io.on('reconnect_attempt', () => {
    useConnection.getState().setConnecting();
  });

  socket.on('connect_error', (err) => {
    useConnection.getState().recordFailure();
    void handleConnectError(err);
  });

  socket.on('disconnect', () => {
    useConnection.getState().setDisconnected();
  });

  socket.on('message:new', (dto: WsMessageDto) => {
    for (const handler of newMessageHandlers) {
      handler(dto);
    }
  });
}

// 서버 미들웨어 거부(next(err))는 socket.active=false — 자동 재연결이 멈춘다.
// access 만료가 원인이면 refresh 후 수동 재연결. refresh가 서버 거부되면
// client.ts의 onUnauthorized 흐름(로그인 화면)에 맡긴다.
async function handleConnectError(err: Error): Promise<void> {
  if (!socket) return;
  if (err.message === 'unauthorized') {
    const refreshed = await refreshTokens();
    if (refreshed && socket) {
      socket.connect();
    }
  }
}

export function disconnectSocket(): void {
  socket?.disconnect();
}

// 재시도는 같은 messageId로 다시 호출 — 서버가 dedupe하고 항상 success ack (멱등성).
export function sendMessage(payload: {
  messageId: string;
  roomId: string;
  content: string;
}): Promise<SendResult> {
  return new Promise((resolve, reject) => {
    if (!socket?.connected) {
      reject(new Error('DISCONNECTED'));
      return;
    }
    socket
      .timeout(SEND_ACK_TIMEOUT_MS)
      .emit('message:send', payload, (err: Error | null, ack: SendAck) => {
        if (err) {
          reject(new Error('ACK_TIMEOUT'));
          return;
        }
        if (ack.ok) {
          resolve(ack.data);
        } else {
          reject(new Error(ack.error.code));
        }
      });
  });
}

// 반환된 함수로 구독 해제. 핸들러는 모든 방의 message:new를 받으므로
// 소비자가 roomId 필터링 책임.
export function subscribeNewMessages(handler: NewMessageHandler): () => void {
  newMessageHandlers.add(handler);
  return () => {
    newMessageHandlers.delete(handler);
  };
}
