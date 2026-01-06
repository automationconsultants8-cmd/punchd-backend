import { Controller, Post, Delete, Body, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { NotificationsService } from './notifications.service';

@ApiTags('Notifications')
@Controller('notifications')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post('register-token')
  @ApiOperation({ summary: 'Register a push notification token' })
  async registerToken(
    @Request() req,
    @Body() dto: { token: string; platform: string },
  ) {
    return this.notificationsService.registerToken(
      req.user.id,
      dto.token,
      dto.platform,
    );
  }

  @Delete('unregister-token')
  @ApiOperation({ summary: 'Unregister a push notification token' })
  async unregisterToken(
    @Request() req,
    @Body() dto: { token: string },
  ) {
    await this.notificationsService.unregisterToken(req.user.id, dto.token);
    return { success: true };
  }

  @Delete('unregister-all')
  @ApiOperation({ summary: 'Unregister all tokens for current user (logout)' })
  async unregisterAll(@Request() req) {
    await this.notificationsService.unregisterAllTokens(req.user.id);
    return { success: true };
  }
}
