import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ShiftRequestsService } from './shift-requests.service';
import { ShiftRequestStatus, ShiftRequestType } from '@prisma/client';

@ApiTags('Shift Requests')
@Controller('shift-requests')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ShiftRequestsController {
  constructor(private readonly shiftRequestsService: ShiftRequestsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a shift request (drop or swap)' })
  create(@Request() req, @Body() dto: {
    shiftId: string;
    requestType: ShiftRequestType;
    reason: string;
    swapTargetId?: string;
    swapShiftId?: string;
  }) {
    return this.shiftRequestsService.create({
      companyId: req.user.companyId,
      requesterId: req.user.id,
      shiftId: dto.shiftId,
      requestType: dto.requestType,
      reason: dto.reason,
      swapTargetId: dto.swapTargetId,
      swapShiftId: dto.swapShiftId,
    });
  }

  @Get()
  @ApiOperation({ summary: 'Get all shift requests (admin)' })
  @ApiQuery({ name: 'status', required: false, enum: ShiftRequestStatus })
  @ApiQuery({ name: 'requestType', required: false, enum: ShiftRequestType })
  findAll(
    @Request() req,
    @Query('status') status?: ShiftRequestStatus,
    @Query('requestType') requestType?: ShiftRequestType,
  ) {
    return this.shiftRequestsService.findAll(req.user.companyId, {
      status,
      requestType,
    });
  }

  @Get('pending')
  @ApiOperation({ summary: 'Get pending shift requests' })
  findPending(@Request() req) {
    return this.shiftRequestsService.findPending(req.user.companyId);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get shift request statistics' })
  getStats(@Request() req) {
    return this.shiftRequestsService.getStats(req.user.companyId);
  }

  @Get('my-requests')
  @ApiOperation({ summary: 'Get current user\'s shift requests' })
  findMyRequests(@Request() req) {
    return this.shiftRequestsService.findByUser(req.user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a shift request by ID' })
  findOne(@Param('id') id: string) {
    return this.shiftRequestsService.findOne(id);
  }

  @Patch(':id/approve')
  @ApiOperation({ summary: 'Approve a shift request' })
  approve(
    @Param('id') id: string,
    @Request() req,
    @Body() dto: { reviewerNotes?: string },
  ) {
    return this.shiftRequestsService.approve(id, req.user.id, dto.reviewerNotes);
  }

  @Patch(':id/decline')
  @ApiOperation({ summary: 'Decline a shift request' })
  decline(
    @Param('id') id: string,
    @Request() req,
    @Body() dto: { reviewerNotes?: string },
  ) {
    return this.shiftRequestsService.decline(id, req.user.id, dto.reviewerNotes);
  }

  @Patch(':id/cancel')
  @ApiOperation({ summary: 'Cancel own shift request' })
  cancel(@Param('id') id: string, @Request() req) {
    return this.shiftRequestsService.cancel(id, req.user.id);
  }
}
