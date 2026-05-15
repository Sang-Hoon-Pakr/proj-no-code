import { Body, Controller, Get, HttpCode, HttpStatus, Patch, UseGuards } from '@nestjs/common';
import { UserService, type UserProfile } from './user.service';
import { JwtAuthGuard, type AuthContext } from '../common/jwt.guard';
import { CurrentUser } from '../common/current-user.decorator';

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
}
