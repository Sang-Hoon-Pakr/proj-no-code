import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ProfileValidationError,
  UserNotFoundError,
  UserService,
  type UserProfile,
} from './user.service';
import { JwtAuthGuard, type AuthContext } from '../common/jwt.guard';
import { CurrentUser } from '../common/current-user.decorator';

// 라우트 선언 순서 중요: 정적 경로(me, search)가 동적 경로(:id)보다 먼저.
@Controller('users')
@UseGuards(JwtAuthGuard)
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get('me')
  async getMe(@CurrentUser() user: AuthContext): Promise<{ data: UserProfile }> {
    const profile = await this.userService.getById(user.userId);
    return { data: profile };
  }

  @Patch('me')
  @HttpCode(HttpStatus.OK)
  async patchMe(
    @CurrentUser() user: AuthContext,
    @Body() body: unknown,
  ): Promise<{ data: UserProfile }> {
    const profile = await this.userService.updateProfile(user.userId, body);
    return { data: profile };
  }

  @Get('search')
  async search(@Query('email') email?: string): Promise<{ data: UserProfile }> {
    if (!email || email.trim().length === 0) {
      throw new ProfileValidationError('email query parameter required');
    }
    const profile = await this.userService.findByEmail(email);
    if (!profile) throw new UserNotFoundError();
    return { data: profile };
  }

  @Get(':id')
  async getById(@Param('id') id: string): Promise<{ data: UserProfile }> {
    const profile = await this.userService.getById(id);
    return { data: profile };
  }
}
