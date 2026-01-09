import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ShiftsService } from './shifts.service';
import { ShiftStatus } from '@prisma/client';

@ApiTags('Shifts')
@Controller('shifts')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ShiftsController {
  constructor(private readonly shiftsService: ShiftsService) {}

  // Helper to parse time string "08:00" or "08:00 AM" with a date
  private parseDateTime(dateStr: string, timeStr: string): Date {
    const date = new Date(dateStr + 'T00:00:00');
    
    // Parse time - handle "08:00", "8:00 AM", "17:00", "5:00 PM"
    let hours = 0;
    let minutes = 0;
    
    const upperTime = timeStr.toUpperCase().trim();
    const isPM = upperTime.includes('PM');
    const isAM = upperTime.includes('AM');
    
    const cleanTime = upperTime.replace(/\s*(AM|PM)\s*/i, '').trim();
    const parts = cleanTime.split(':');
    
    hours = parseInt(parts[0], 10);
    minutes = parts[1] ? parseInt(parts[1], 10) : 0;
    
    if (isPM && hours !== 12) {
      hours += 12;
    } else if (isAM && hours === 12) {
      hours = 0;
    }
    
    date.setHours(hours, minutes, 0, 0);
    return date;
  }

  @Post()
  @ApiOperation({ summary: 'Create a shift' })
  create(
    @Request() req,
    @Body() dto: {
      userId?: string;
      jobId: string;
      date?: string;
      shiftDate?: string;
      startTime: string;
      endTime: string;
      notes?: string;
      isOpen?: boolean;
    },
  ) {
    const dateStr = dto.date || dto.shiftDate;
    if (!dateStr) {
      throw new Error('Date is required');
    }

    const shiftDate = new Date(dateStr + 'T00:00:00');
    const startTime = this.parseDateTime(dateStr, dto.startTime);
    const endTime = this.parseDateTime(dateStr, dto.endTime);

    return this.shiftsService.create({
      companyId: req.user.companyId,
      userId: dto.userId,
      jobId: dto.jobId,
      shiftDate,
      startTime,
      endTime,
      notes: dto.notes,
      isOpen: dto.isOpen,
    });
  }

  @Post('open')
  @ApiOperation({ summary: 'Create an open shift (available for claiming)' })
  createOpenShift(
    @Request() req,
    @Body() dto: {
      jobId: string;
      date?: string;
      shiftDate?: string;
      startTime: string;
      endTime: string;
      notes?: string;
    },
  ) {
    const dateStr = dto.date || dto.shiftDate;
    if (!dateStr) {
      throw new Error('Date is required');
    }

    const shiftDate = new Date(dateStr + 'T00:00:00');
    const startTime = this.parseDateTime(dateStr, dto.startTime);
    const endTime = this.parseDateTime(dateStr, dto.endTime);

    return this.shiftsService.createOpenShift({
      companyId: req.user.companyId,
      jobId: dto.jobId,
      shiftDate,
      startTime,
      endTime,
      notes: dto.notes,
    });
  }

  @Get()
  @ApiOperation({ summary: 'Get all shifts' })
  @ApiQuery({ name: 'userId', required: false })
  @ApiQuery({ name: 'jobId', required: false })
  @ApiQuery({ name: 'status', required: false, enum: ShiftStatus })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  @ApiQuery({ name: 'isOpen', required: false })
  findAll(
    @Request() req,
    @Query('userId') userId?: string,
    @Query('jobId') jobId?: string,
    @Query('status') status?: ShiftStatus,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('isOpen') isOpen?: string,
  ) {
    return this.shiftsService.findAll(req.user.companyId, {
      userId,
      jobId,
      status,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      isOpen: isOpen !== undefined ? isOpen === 'true' : undefined,
    });
  }

  @Get('open')
  @ApiOperation({ summary: 'Get all open shifts available for claiming' })
  findOpenShifts(@Request() req) {
    return this.shiftsService.findOpenShifts(req.user.companyId);
  }

  @Get('user/:userId')
  @ApiOperation({ summary: 'Get shifts for a specific user' })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  @ApiQuery({ name: 'status', required: false, enum: ShiftStatus })
  findByUser(
    @Param('userId') userId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('status') status?: ShiftStatus,
  ) {
    return this.shiftsService.findByUser(userId, {
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      status,
    });
  }

  @Get('my-shifts')
  @ApiOperation({ summary: 'Get current user\'s shifts' })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  @ApiQuery({ name: 'status', required: false, enum: ShiftStatus })
  findMyShifts(
    @Request() req,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('status') status?: ShiftStatus,
  ) {
    return this.shiftsService.findByUser(req.user.id, {
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      status,
    });
  }

  @Get('upcoming')
  @ApiOperation({ summary: 'Get upcoming shifts for the next N days' })
  @ApiQuery({ name: 'days', required: false })
  getUpcoming(@Request() req, @Query('days') days?: string) {
    return this.shiftsService.getUpcomingShifts(req.user.companyId, days ? parseInt(days) : 7);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get shift statistics' })
  getStats(@Request() req) {
    return this.shiftsService.getStats(req.user.companyId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a shift by ID' })
  findOne(@Param('id') id: string) {
    return this.shiftsService.findOne(id);
  }

  @Post(':id/claim')
  @ApiOperation({ summary: 'Claim an open shift' })
  claimShift(@Param('id') id: string, @Request() req) {
    return this.shiftsService.claimShift(id, req.user.id, req.user.companyId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a shift' })
  update(
    @Param('id') id: string,
    @Request() req,
    @Body() dto: {
      userId?: string;
      jobId?: string;
      shiftDate?: string;
      startTime?: string;
      endTime?: string;
      status?: ShiftStatus;
      notes?: string;
      isOpen?: boolean;
    },
  ) {
    return this.shiftsService.update(
      id,
      {
        userId: dto.userId,
        jobId: dto.jobId,
        shiftDate: dto.shiftDate ? new Date(dto.shiftDate) : undefined,
        startTime: dto.startTime ? new Date(dto.startTime) : undefined,
        endTime: dto.endTime ? new Date(dto.endTime) : undefined,
        status: dto.status,
        notes: dto.notes,
        isOpen: dto.isOpen,
      },
      req.user.id,
    );
  }

  @Patch(':id/mark-open')
  @ApiOperation({ summary: 'Mark a shift as open (admin)' })
  markAsOpen(@Param('id') id: string, @Request() req) {
    return this.shiftsService.markAsOpen(id, req.user.id);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update shift status' })
  updateStatus(
    @Param('id') id: string,
    @Request() req,
    @Body() dto: { status: ShiftStatus },
  ) {
    return this.shiftsService.updateStatus(id, dto.status, req.user.id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a shift' })
  delete(@Param('id') id: string, @Request() req) {
    return this.shiftsService.delete(id, req.user.id);
  }
}
