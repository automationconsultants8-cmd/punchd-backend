import { Controller, Get, Post, Body, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { TimeEntriesService } from './time-entries.service';
import { ClockInDto, ClockOutDto } from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Time Entries')
@Controller('time-entries')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class TimeEntriesController {
  constructor(private readonly timeEntriesService: TimeEntriesService) {}

  @Post('clock-in')
  @ApiOperation({ summary: 'Clock in (job or travel time)' })
  clockIn(@Request() req, @Body() dto: ClockInDto) {
    return this.timeEntriesService.clockIn(req.user.userId, req.user.companyId, dto);
  }

  @Post('clock-out')
  @ApiOperation({ summary: 'Clock out from current entry' })
  clockOut(@Request() req, @Body() dto: ClockOutDto) {
    return this.timeEntriesService.clockOut(req.user.userId, req.user.companyId, dto);
  }

  @Get('status')
  @ApiOperation({ summary: 'Get current clock-in status' })
  getCurrentStatus(@Request() req) {
    return this.timeEntriesService.getCurrentStatus(req.user.userId, req.user.companyId);
  }

  @Post('start-break')
  @ApiOperation({ summary: 'Start a break' })
  startBreak(@Request() req) {
    return this.timeEntriesService.startBreak(req.user.userId);
  }

  @Post('end-break')
  @ApiOperation({ summary: 'End current break' })
  endBreak(@Request() req) {
    return this.timeEntriesService.endBreak(req.user.userId);
  }

  @Get('all')
  @ApiOperation({ summary: 'Get all time entries for company (admin)' })
  getAllForCompany(@Request() req) {
    return this.timeEntriesService.getTimeEntries(req.user.companyId, {});
  }

  @Get()
  @ApiOperation({ summary: 'Get time entries with filters' })
  @ApiQuery({ name: 'userId', required: false, type: String })
  @ApiQuery({ name: 'jobId', required: false, type: String })
  @ApiQuery({ name: 'startDate', required: false, type: String })
  @ApiQuery({ name: 'endDate', required: false, type: String })
  @ApiQuery({ name: 'entryType', required: false, enum: ['JOB_TIME', 'TRAVEL_TIME'] })
  getTimeEntries(
    @Request() req,
    @Query('userId') userId?: string,
    @Query('jobId') jobId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('entryType') entryType?: 'JOB_TIME' | 'TRAVEL_TIME',
  ) {
    return this.timeEntriesService.getTimeEntries(req.user.companyId, {
      userId,
      jobId,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      entryType,
    });
  }
}