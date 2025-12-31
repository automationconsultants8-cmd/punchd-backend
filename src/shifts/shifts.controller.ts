import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { FeatureGuard } from '../features/feature.guard';
import { RequireFeature } from '../features/feature.decorator';
import { ShiftsService } from './shifts.service';

@ApiTags('Shifts')
@Controller('shifts')
@UseGuards(JwtAuthGuard, FeatureGuard)
@ApiBearerAuth()
export class ShiftsController {
  constructor(private readonly shiftsService: ShiftsService) {}

  @Post()
  @RequireFeature('SHIFT_SCHEDULING')
  @ApiOperation({ summary: 'Create a new shift' })
  create(@Request() req, @Body() dto: any) {
    return this.shiftsService.create({
      companyId: req.user.companyId,
      userId: dto.userId,
      jobId: dto.jobId,
      shiftDate: new Date(dto.shiftDate || dto.date),
      startTime: new Date(dto.startTime),
      endTime: new Date(dto.endTime),
      notes: dto.notes,
    });
  }

  @Get()
  @RequireFeature('SHIFT_SCHEDULING')
  @ApiOperation({ summary: 'Get all shifts' })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  @ApiQuery({ name: 'jobId', required: false })
  @ApiQuery({ name: 'userId', required: false })
  findAll(
    @Request() req,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('jobId') jobId?: string,
    @Query('userId') userId?: string,
  ) {
    return this.shiftsService.findAll(req.user.companyId, {
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      jobId,
      userId,
    });
  }

  @Get('today')
  @RequireFeature('SHIFT_SCHEDULING')
  @ApiOperation({ summary: 'Get today\'s shifts' })
  getTodayShifts(@Request() req) {
    return this.shiftsService.getTodayShifts(req.user.companyId);
  }

  @Get('user/:userId')
  @RequireFeature('SHIFT_SCHEDULING')
  @ApiOperation({ summary: 'Get shifts for a specific user' })
  getByUser(
    @Param('userId') userId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.shiftsService.findByUser(userId, {
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
    });
  }

  @Get(':id')
  @RequireFeature('SHIFT_SCHEDULING')
  @ApiOperation({ summary: 'Get a shift by ID' })
  findOne(@Param('id') id: string) {
    return this.shiftsService.findOne(id);
  }

  @Put(':id')
  @RequireFeature('SHIFT_SCHEDULING')
  @ApiOperation({ summary: 'Update a shift' })
  update(@Param('id') id: string, @Body() dto: any) {
    return this.shiftsService.update(id, {
      userId: dto.userId,
      jobId: dto.jobId,
      shiftDate: dto.shiftDate ? new Date(dto.shiftDate) : undefined,
      startTime: dto.startTime ? new Date(dto.startTime) : undefined,
      endTime: dto.endTime ? new Date(dto.endTime) : undefined,
      status: dto.status,
      notes: dto.notes,
    });
  }

  @Delete(':id')
  @RequireFeature('SHIFT_SCHEDULING')
  @ApiOperation({ summary: 'Delete a shift' })
  remove(@Param('id') id: string) {
    return this.shiftsService.remove(id);
  }

  @Post('bulk')
  @RequireFeature('SHIFT_SCHEDULING')
  @ApiOperation({ summary: 'Create multiple shifts' })
  createMany(@Request() req, @Body() dto: { shifts: any[] }) {
    const shifts = dto.shifts.map(s => ({
      companyId: req.user.companyId,
      userId: s.userId,
      jobId: s.jobId,
      shiftDate: new Date(s.shiftDate || s.date),
      startTime: new Date(s.startTime),
      endTime: new Date(s.endTime),
      notes: s.notes,
    }));
    return this.shiftsService.createMany(shifts);
  }
}