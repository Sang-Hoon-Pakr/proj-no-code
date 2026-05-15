import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { MessageService, type ListInRoomOutput } from './message.service';
import { JwtAuthGuard, type AuthContext } from '../common/jwt.guard';
import { CurrentUser } from '../common/current-user.decorator';

// /rooms/:id/messages 는 RoomController와 prefix가 겹치지만
// NestJS는 sub-path가 다르면 충돌 없이 등록함 (실제 routing은 sub-path 기준).
@Controller('rooms')
@UseGuards(JwtAuthGuard)
export class MessageController {
  constructor(private readonly messageService: MessageService) {}

  @Get(':id/messages')
  async listInRoom(
    @CurrentUser() user: AuthContext,
    @Param('id') roomId: string,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
  ): Promise<ListInRoomOutput> {
    const beforeNum = before !== undefined ? Number(before) : undefined;
    const limitNum = limit !== undefined ? Number(limit) : undefined;
    return this.messageService.listInRoom({
      roomId,
      userId: user.userId,
      before: Number.isFinite(beforeNum) ? beforeNum : undefined,
      limit: Number.isFinite(limitNum) ? limitNum : undefined,
    });
  }
}
