import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TimeOffService } from './time-off.service';
import { TimeOffStatus, TimeOffType } from '@prisma/client';
import { RequiresFeature } from '../features/feature.decorator';
import { FeatureGuard } from '../features/feature.guard';

@ApiTags('Time Off')
@Controller('time-off')
@UseGuards(JwtAuthGuard, FeatureGuard)
@RequiresFeature('TIME_OFF')
@ApiBearerAuth()
export class TimeOffController {
  constructor(private readonly timeOffService: TimeOffService) {}

  @Post()
  @ApiOperation({ summary: 'Create a time off request' })
  create(@Request() req, @Body() dto: {
    timeOffType: TimeOffType;
    startDate: string;
    endDate: string;
    reason?: string;
  }) {
    return this.timeOffService.create({
      companyId: req.user.companyId,
      requesterId: req.user.id,
      timeOffType: dto.timeOffType,
      startDate: new Date(dto.startDate),
      endDate: new Date(dto.endDate),
      reason: dto.reason,
    });
  }

  @Get()
  @ApiOperation({ summary: 'Get all time off requests (admin)' })
  @ApiQuery({ name: 'status', required: false, enum: TimeOffStatus })
  @ApiQuery({ name: 'timeOffType', required: false, enum: TimeOffType })
  findAll(
    @Request() req,
    @Query('status') status?: TimeOffStatus,
    @Query('timeOffType') timeOffType?: TimeOffType,
  ) {
    return this.timeOffService.findAll(req.user.companyId, {
      status,
      timeOffType,
    });
  }

  @Get('pending')
  @ApiOperation({ summary: 'Get pending time off requests' })
  findPending(@Request() req) {
    return this.timeOffService.findPending(req.user.companyId);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get time off request statistics' })
  getStats(@Request() req) {
    return this.timeOffService.getStats(req.user.companyId);
  }

  @Get('my-requests')
  @ApiOperation({ summary: 'Get current user\'s time off requests' })
  findMyRequests(@Request() req) {
    return this.timeOffService.findByUser(req.user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a time off request by ID' })
  findOne(@Param('id') id: string) {
    return this.timeOffService.findOne(id);
  }

  @Patch(':id/approve')
  @ApiOperation({ summary: 'Approve a time off request' })
  approve(
    @Param('id') id: string,
    @Request() req,
    @Body() dto: { reviewerNotes?: string },
  ) {
    return this.timeOffService.approve(id, req.user.id, dto.reviewerNotes);
  }

  @Patch(':id/decline')
  @ApiOperation({ summary: 'Decline a time off request' })
  decline(
    @Param('id') id: string,
    @Request() req,
    @Body() dto: { reviewerNotes?: string },
  ) {
    return this.timeOffService.decline(id, req.user.id, dto.reviewerNotes);
  }

  @Patch(':id/cancel')
  @ApiOperation({ summary: 'Cancel own time off request' })
  cancel(@Param('id') id: string, @Request() req) {
    return this.timeOffService.cancel(id, req.user.id);
  }
}
