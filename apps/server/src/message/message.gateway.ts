import { Inject, Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import jwt from 'jsonwebtoken';
import type { Server, Socket } from 'socket.io';
import { JWT_SECRET_TOKEN } from '../common/jwt.guard';
import { RoomService } from '../room/room.service';
import { MessageService, NotInRoomError } from './message.service';

interface MessageSendPayload {
  messageId: string;
  roomId: string;
  content: string;
}

interface AckOk {
  ok: true;
  data: { messageId: string; createdAt: string };
}
interface AckError {
  ok: false;
  error: { code: string; message: string };
}
type Ack = AckOk | AckError;

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
export class MessageGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(MessageGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly messageService: MessageService,
    private readonly roomService: RoomService,
    @Inject(JWT_SECRET_TOKEN) private readonly jwtSecret: string,
  ) {}

  // realtime-rules.md: 핸드셰이크 단계 인증은 middleware (handleConnection은 연결 완료 후 호출).
  afterInit(server: Server): void {
    server.use((socket, next) => {
      const token = this.extractTokenFromHandshake(socket);
      if (!token) {
        next(new Error('unauthorized'));
        return;
      }
      try {
        const payload = jwt.verify(token, this.jwtSecret) as JwtPayload;
        (socket.data as SocketUserData) = { userId: payload.sub };
        next();
      } catch {
        next(new Error('unauthorized'));
      }
    });
  }

  async handleConnection(client: Socket): Promise<void> {
    const { userId } = client.data as SocketUserData;
    // 사용자가 속한 모든 방의 Socket.IO room에 join — fan-out 채널.
    const roomIds = await this.roomService.listRoomsForUser(userId);
    for (const roomId of roomIds) {
      await client.join(roomId);
    }
  }

  @SubscribeMessage('message:send')
  async handleMessageSend(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: MessageSendPayload,
  ): Promise<Ack> {
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
      client.to(msg.roomId).emit('message:new', {
        messageId: msg.id,
        roomId: msg.roomId,
        senderId: msg.senderId,
        content: msg.content,
        createdAt: msg.createdAt.toISOString(),
      });

      return {
        ok: true,
        data: { messageId: msg.id, createdAt: msg.createdAt.toISOString() },
      };
    } catch (e) {
      if (e instanceof NotInRoomError) {
        return { ok: false, error: { code: 'NOT_FOUND', message: 'not found' } };
      }
      this.logger.error(e);
      return { ok: false, error: { code: 'INTERNAL', message: 'internal' } };
    }
  }

  private extractTokenFromHandshake(socket: Socket): string | undefined {
    const auth = socket.handshake.auth as { token?: unknown } | undefined;
    if (auth && typeof auth.token === 'string' && auth.token.length > 0) {
      return auth.token;
    }
    return undefined;
  }
}
