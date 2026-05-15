import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { RoomService, type ListRoomsOutput, type Room } from './room.service';
import { JwtAuthGuard, type AuthContext } from '../common/jwt.guard';
import { CurrentUser } from '../common/current-user.decorator';

interface CreateDirectBody {
  otherUserId?: unknown;
}
interface CreateGroupBody {
  name?: unknown;
  memberIds?: unknown;
}
interface AddMemberBody {
  userId?: unknown;
}

@Controller('rooms')
@UseGuards(JwtAuthGuard)
export class RoomController {
  constructor(private readonly roomService: RoomService) {}

  @Post('direct')
  @HttpCode(HttpStatus.OK)
  async createDirect(
    @CurrentUser() user: AuthContext,
    @Body() body: CreateDirectBody,
  ): Promise<{ data: Room }> {
    const room = await this.roomService.createDirect({
      userIdA: user.userId,
      userIdB: body.otherUserId as string,
    });
    return { data: room };
  }

  @Post('group')
  @HttpCode(HttpStatus.OK)
  async createGroup(
    @CurrentUser() user: AuthContext,
    @Body() body: CreateGroupBody,
  ): Promise<{ data: Room }> {
    const room = await this.roomService.createGroup({
      creatorId: user.userId,
      name: body.name as string,
      memberIds: (body.memberIds as string[]) ?? [],
    });
    return { data: room };
  }

  @Post(':id/members')
  @HttpCode(HttpStatus.NO_CONTENT)
  async addMember(
    @CurrentUser() user: AuthContext,
    @Param('id') roomId: string,
    @Body() body: AddMemberBody,
  ): Promise<void> {
    await this.roomService.addMember({
      roomId,
      userId: body.userId as string,
      addedBy: user.userId,
    });
  }

  @Post(':id/leave')
  @HttpCode(HttpStatus.NO_CONTENT)
  async leave(@CurrentUser() user: AuthContext, @Param('id') roomId: string): Promise<void> {
    await this.roomService.leave({ roomId, userId: user.userId });
  }

  @Get('me')
  async listMyRooms(
    @CurrentUser() user: AuthContext,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ): Promise<ListRoomsOutput> {
    const parsedLimit = limit !== undefined ? Number(limit) : undefined;
    return this.roomService.listForUser({
      userId: user.userId,
      cursor,
      limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined,
    });
  }
}
