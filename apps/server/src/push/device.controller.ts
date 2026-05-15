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
import { DeviceService, type DeviceRecord } from './device.service';
import { JwtAuthGuard, type AuthContext } from '../common/jwt.guard';
import { CurrentUser } from '../common/current-user.decorator';

@Controller('users/me/devices')
@UseGuards(JwtAuthGuard)
export class DeviceController {
  constructor(private readonly deviceService: DeviceService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async register(
    @CurrentUser() user: AuthContext,
    @Body() body: unknown,
  ): Promise<{ data: DeviceRecord }> {
    const device = await this.deviceService.register(user.userId, body);
    return { data: device };
  }

  @Get()
  async list(@CurrentUser() user: AuthContext): Promise<{ data: DeviceRecord[] }> {
    const devices = await this.deviceService.listForUser(user.userId);
    return { data: devices };
  }

  @Delete(':deviceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: AuthContext,
    @Param('deviceId') deviceId: string,
  ): Promise<void> {
    await this.deviceService.remove(user.userId, deviceId);
  }
}
