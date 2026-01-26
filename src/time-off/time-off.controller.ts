import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { TimeOffService } from './time-off.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TimeOffType, TimeOffStatus } from '@prisma/client';

@ApiTags('Time Off')
@Controller('time-off')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class TimeOffController {
  constructor(private readonly timeOffService: TimeOffService) {}

  // ============================================
  // WORKER ENDPOINTS (My requests & balances)
  // ============================================

  @Get('my-requests')
  @ApiOperation({ summary: 'Get my time off requests' })
  async getMyRequests(@Request() req) {
    return this.timeOffService.findByUser(req.user.userId);
  }

  @Get('my-balances')
  @ApiOperation({ summary: 'Get my leave balances' })
  async getMyBalances(@Request() req) {
    return this.timeOffService.getMyBalances(req.user.userId, req.user.companyId);
  }

  @Post('request')
  @ApiOperation({ summary: 'Create a new time off request' })
  async createRequest(
    @Request() req,
    @Body() body: {
      type: TimeOffType;
      startDate: string;
      endDate: string;
      hoursRequested?: number;
      reason?: string;
    },
  ) {
    return this.timeOffService.create({
      companyId: req.user.companyId,
      requesterId: req.user.userId,
      timeOffType: body.type,
      startDate: new Date(body.startDate),
      endDate: new Date(body.endDate),
      hoursRequested: body.hoursRequested,
      reason: body.reason,
    });
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel my time off request' })
  async cancelRequest(@Request() req, @Param('id') id: string) {
    return this.timeOffService.cancel(id, req.user.userId);
  }

  // ============================================
  // ADMIN/MANAGER ENDPOINTS
  // ============================================

  @Get()
  @ApiOperation({ summary: 'Get all time off requests' })
  @ApiQuery({ name: 'status', required: false, enum: TimeOffStatus })
  @ApiQuery({ name: 'type', required: false, enum: TimeOffType })
  @ApiQuery({ name: 'userId', required: false })
  async getAllRequests(
    @Request() req,
    @Query('status') status?: TimeOffStatus,
    @Query('type') type?: TimeOffType,
    @Query('userId') userId?: string,
  ) {
    return this.timeOffService.findAll(req.user.companyId, {
      status,
      timeOffType: type,
      requesterId: userId,
    });
  }

  @Get('pending')
  @ApiOperation({ summary: 'Get pending time off requests' })
  async getPendingRequests(@Request() req) {
    return this.timeOffService.findPending(req.user.companyId);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get time off statistics' })
  async getStats(@Request() req) {
    return this.timeOffService.getStats(req.user.companyId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get time off request details' })
  async getRequest(@Param('id') id: string) {
    return this.timeOffService.findOne(id);
  }

  @Patch(':id/approve')
  @ApiOperation({ summary: 'Approve a time off request' })
  async approveRequest(
    @Request() req,
    @Param('id') id: string,
    @Body() body: { notes?: string },
  ) {
    return this.timeOffService.approve(id, req.user.userId, body.notes);
  }

  @Patch(':id/decline')
  @ApiOperation({ summary: 'Decline a time off request' })
  async declineRequest(
    @Request() req,
    @Param('id') id: string,
    @Body() body: { notes?: string },
  ) {
    return this.timeOffService.decline(id, req.user.userId, body.notes);
  }
}
