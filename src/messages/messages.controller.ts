import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MessagesService } from './messages.service';
import { RequiresFeature } from '../features/feature.decorator';
import { FeatureGuard } from '../features/feature.guard';

@ApiTags('Messages')
@Controller('messages')
@UseGuards(JwtAuthGuard, FeatureGuard)
@RequiresFeature('MESSAGES')
@ApiBearerAuth()
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Post()
  @ApiOperation({ summary: 'Send a message' })
  create(@Request() req, @Body() dto: {
    recipientId?: string;
    subject?: string;
    body: string;
    shiftRequestId?: string;
    timeOffRequestId?: string;
  }) {
    return this.messagesService.create({
      companyId: req.user.companyId,
      senderId: req.user.id,
      recipientId: dto.recipientId,
      subject: dto.subject,
      body: dto.body,
      shiftRequestId: dto.shiftRequestId,
      timeOffRequestId: dto.timeOffRequestId,
    });
  }

  @Get('inbox')
  @ApiOperation({ summary: 'Get inbox messages' })
  findInbox(@Request() req) {
    return this.messagesService.findInbox(req.user.companyId, req.user.id);
  }

  @Get('sent')
  @ApiOperation({ summary: 'Get sent messages' })
  findSent(@Request() req) {
    return this.messagesService.findSent(req.user.companyId, req.user.id);
  }

  @Get('unread')
  @ApiOperation({ summary: 'Get unread messages' })
  findUnread(@Request() req) {
    return this.messagesService.findUnread(req.user.companyId, req.user.id);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Get unread message count' })
  getUnreadCount(@Request() req) {
    return this.messagesService.getUnreadCount(req.user.companyId, req.user.id);
  }

  @Get('admin')
  @ApiOperation({ summary: 'Get messages sent to admins (admin only)' })
  findAdminMessages(@Request() req) {
    return this.messagesService.findAdminMessages(req.user.companyId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a message by ID' })
  findOne(@Param('id') id: string, @Request() req) {
    return this.messagesService.findOne(id, req.user.id);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark message as read' })
  markAsRead(@Param('id') id: string, @Request() req) {
    return this.messagesService.markAsRead(id, req.user.id);
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Mark all messages as read' })
  markAllAsRead(@Request() req) {
    return this.messagesService.markAllAsRead(req.user.companyId, req.user.id);
  }
}
