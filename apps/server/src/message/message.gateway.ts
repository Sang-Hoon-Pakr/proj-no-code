import { Inject, Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import jwt from 'jsonwebtoken';
import type { Server, Socket } from 'socket.io';
import { JWT_SECRET_TOKEN } from '../common/jwt.guard';
import { RoomService } from '../room/room.service';
import { PushService } from '../push/push.service';
import { MessageService, NotInRoomError } from './message.service';

interface MessageSendPayload {
  messageId: string;
  roomId: string;
  content: string;
}

interface MessagesSincePayload {
  roomId: string;
  sinceSeq: number;
  limit?: number;
}

interface ReadMarkPayload {
  roomId: string;
  seq: number;
}

interface MessageDto {
  messageId: string;
  roomId: string;
  senderId: string;
  content: string;
  seq: number;
  createdAt: string;
}

interface SendAckOk {
  ok: true;
  data: { messageId: string; seq: number; createdAt: string };
}
interface SinceAckOk {
  ok: true;
  data: { messages: MessageDto[]; hasMore: boolean };
}
interface AckError {
  ok: false;
  error: { code: string; message: string };
}
interface OkAck {
  ok: true;
}
type SendAck = SendAckOk | AckError;
type SinceAck = SinceAckOk | AckError;
type ReadAck = OkAck | AckError;

interface SocketUserData {
  userId: string;
}

interface JwtPayload {
  sub: string;
}

// realtime-rules.md: ack 5초 내, transports=['websocket'] (long-polling 회피 가능)
@WebSocketGateway({
  cors: { origin: '*' },
  transports: ['websocket'],
})
export class MessageGateway implements OnGatewayInit {
  private readonly logger = new Logger(MessageGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly messageService: MessageService,
    private readonly roomService: RoomService,
    private readonly pushService: PushService,
    @Inject(JWT_SECRET_TOKEN) private readonly jwtSecret: string,
  ) {}

  // realtime-rules.md: 핸드셰이크 단계 인증 + fan-out에 영향 주는 setup(join 등)은
  // 모두 미들웨어에서 완료. handleConnection은 클라이언트 `connect`와 race 가능.
  afterInit(server: Server): void {
    server.use((socket, next) => {
      void this.authAndJoin(socket).then(
        () => next(),
        (err: Error) => next(err),
      );
    });
  }

  private async authAndJoin(socket: Socket): Promise<void> {
    const token = this.extractTokenFromHandshake(socket);
    if (!token) throw new Error('unauthorized');

    let userId: string;
    try {
      const payload = jwt.verify(token, this.jwtSecret) as JwtPayload;
      userId = payload.sub;
    } catch {
      throw new Error('unauthorized');
    }

    (socket.data as SocketUserData) = { userId };

    // 모든 방 join을 connect 이벤트 발화 전에 완료 — fan-out race 차단.
    const roomIds = await this.roomService.listRoomsForUser(userId);
    for (const roomId of roomIds) {
      await socket.join(roomId);
    }
  }

  @SubscribeMessage('message:send')
  async handleMessageSend(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: MessageSendPayload,
  ): Promise<SendAck> {
    const { userId } = client.data as SocketUserData;
    try {
      const msg = await this.messageService.create({
        messageId: payload.messageId,
        roomId: payload.roomId,
        senderId: userId,
        content: payload.content,
      });

      // 본인 sender의 join 보장 (방 가입 직후 첫 메시지 케이스).
      await client.join(msg.roomId);

      // fan-out: 본인 제외, 같은 방의 다른 소켓.
      client.to(msg.roomId).emit('message:new', this.toDto(msg));

      // 오프라인 멤버에게는 push. fire-and-forget — push 실패가 ack를 막지 않음.
      void this.pushToOfflineMembers(msg.roomId, msg.id, userId);

      return {
        ok: true,
        data: { messageId: msg.id, seq: msg.seq, createdAt: msg.createdAt.toISOString() },
      };
    } catch (e) {
      if (e instanceof NotInRoomError) {
        return { ok: false, error: { code: 'NOT_FOUND', message: 'not found' } };
      }
      this.logger.error(e);
      return { ok: false, error: { code: 'INTERNAL', message: 'internal' } };
    }
  }

  @SubscribeMessage('read:mark')
  async handleReadMark(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: ReadMarkPayload,
  ): Promise<ReadAck> {
    const { userId } = client.data as SocketUserData;
    try {
      await this.messageService.markRead({
        roomId: payload.roomId,
        userId,
        seq: payload.seq,
      });
      return { ok: true };
    } catch (e) {
      if (e instanceof NotInRoomError) {
        return { ok: false, error: { code: 'NOT_FOUND', message: 'not found' } };
      }
      this.logger.error(e);
      return { ok: false, error: { code: 'INTERNAL', message: 'internal' } };
    }
  }

  @SubscribeMessage('messages:since')
  async handleMessagesSince(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: MessagesSincePayload,
  ): Promise<SinceAck> {
    const { userId } = client.data as SocketUserData;
    try {
      const result = await this.messageService.listSince({
        roomId: payload.roomId,
        userId,
        sinceSeq: payload.sinceSeq,
        limit: payload.limit,
      });
      return {
        ok: true,
        data: {
          messages: result.messages.map((m) => this.toDto(m)),
          hasMore: result.hasMore,
        },
      };
    } catch (e) {
      if (e instanceof NotInRoomError) {
        return { ok: false, error: { code: 'NOT_FOUND', message: 'not found' } };
      }
      this.logger.error(e);
      return { ok: false, error: { code: 'INTERNAL', message: 'internal' } };
    }
  }

  private async pushToOfflineMembers(
    roomId: string,
    messageId: string,
    senderId: string,
  ): Promise<void> {
    try {
      const memberIds = await this.roomService.listMemberIds(roomId);
      const sockets = await this.server.in(roomId).fetchSockets();
      const onlineUserIds = new Set<string>();
      for (const s of sockets) {
        const data = s.data as Partial<SocketUserData>;
        if (data.userId) onlineUserIds.add(data.userId);
      }
      const offlineTargets = memberIds.filter((uid) => uid !== senderId && !onlineUserIds.has(uid));
      if (offlineTargets.length === 0) return;

      // security-rules.md + mobile-rules.md: 푸시 페이로드에 메시지 본문 포함 금지.
      const payload = {
        notification: { title: '새 메시지', body: '새 메시지' },
        data: { roomId, messageId, senderId },
      };
      await Promise.all(
        offlineTargets.map((uid) =>
          this.pushService.sendToUser(uid, payload).catch((e) => {
            this.logger.warn(`pushToOfflineMembers user=${uid} error=${e}`);
          }),
        ),
      );
    } catch (e) {
      this.logger.warn(`pushToOfflineMembers ${e}`);
    }
  }

  private toDto(msg: {
    id: string;
    roomId: string;
    senderId: string;
    content: string;
    seq: number;
    createdAt: Date;
  }): MessageDto {
    return {
      messageId: msg.id,
      roomId: msg.roomId,
      senderId: msg.senderId,
      content: msg.content,
      seq: msg.seq,
      createdAt: msg.createdAt.toISOString(),
    };
  }

  private extractTokenFromHandshake(socket: Socket): string | undefined {
    const auth = socket.handshake.auth as { token?: unknown } | undefined;
    if (auth && typeof auth.token === 'string' && auth.token.length > 0) {
      return auth.token;
    }
    return undefined;
  }
}
