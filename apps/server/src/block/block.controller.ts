import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { BlockService, type BlockedUser } from './block.service';
import { JwtAuthGuard, type AuthContext } from '../common/jwt.guard';
import { CurrentUser } from '../common/current-user.decorator';

interface CreateBlockBody {
  userId?: unknown;
}

@Controller('users/me/blocks')
@UseGuards(JwtAuthGuard)
export class BlockController {
  constructor(private readonly blockService: BlockService) {}

  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  async create(@CurrentUser() user: AuthContext, @Body() body: CreateBlockBody): Promise<void> {
    await this.blockService.create(user.userId, body.userId as string);
  }

  @Delete(':userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: AuthContext,
    @Param('userId') blockedId: string,
  ): Promise<void> {
    await this.blockService.remove(user.userId, blockedId);
  }

  @Get()
  async list(@CurrentUser() user: AuthContext): Promise<{ data: BlockedUser[] }> {
    const blocks = await this.blockService.list(user.userId);
    return { data: blocks };
  }
}
