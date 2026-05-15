import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { AuthService, type TokenPair, type User } from './auth.service';
import { AuthRateLimitGuard } from './auth-rate-limit.guard';

interface RegisterBody {
  email?: unknown;
  password?: unknown;
}
interface LoginBody {
  email?: unknown;
  password?: unknown;
}
interface RefreshBody {
  refreshToken?: unknown;
}

@Controller('auth')
@UseGuards(AuthRateLimitGuard)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  async register(@Body() body: RegisterBody): Promise<{ data: User }> {
    const user = await this.authService.register({
      email: body.email as string,
      password: body.password as string,
    });
    return { data: user };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() body: LoginBody): Promise<{ data: TokenPair }> {
    const tokens = await this.authService.login({
      email: body.email as string,
      password: body.password as string,
    });
    return { data: tokens };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() body: RefreshBody): Promise<{ data: TokenPair }> {
    const tokens = await this.authService.refresh(body.refreshToken as string);
    return { data: tokens };
  }
}
