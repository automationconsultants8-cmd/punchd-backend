import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TimesheetsService } from './timesheets.service';
import { CreateTimesheetDto, ReviewTimesheetDto, UpdateTimesheetDto } from './dto/timesheet.dto';

@ApiTags('Timesheets')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('timesheets')
export class TimesheetsController {
  constructor(private readonly timesheetsService: TimesheetsService) {}

  // Contractor endpoints
  @Get('mine')
  @ApiOperation({ summary: 'Get my timesheets' })
  getMyTimesheets(@Request() req) {
    return this.timesheetsService.getMyTimesheets(req.user.userId, req.user.companyId);
  }

  @Get('mine/unsubmitted-entries')
  @ApiOperation({ summary: 'Get my unsubmitted time entries' })
  getUnsubmittedEntries(
    @Request() req,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('workerType') workerType?: string,
  ) {
    return this.timesheetsService.getUnsubmittedEntries(
      req.user.userId,
      req.user.companyId,
      startDate,
      endDate,
      workerType,
    );
  }

  @Post()
  @ApiOperation({ summary: 'Create a timesheet with selected entries' })
  create(@Request() req, @Body() dto: CreateTimesheetDto) {
    return this.timesheetsService.create(req.user.userId, req.user.companyId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a draft timesheet (add/remove entries)' })
  update(@Request() req, @Param('id') id: string, @Body() dto: UpdateTimesheetDto) {
    return this.timesheetsService.update(id, req.user.userId, req.user.companyId, dto);
  }

  @Patch(':id/submit')
  @ApiOperation({ summary: 'Submit timesheet for approval' })
  submit(@Request() req, @Param('id') id: string) {
    return this.timesheetsService.submit(id, req.user.userId, req.user.companyId);
  }

  @Patch(':id/withdraw')
  @ApiOperation({ summary: 'Withdraw submitted timesheet' })
  withdraw(@Request() req, @Param('id') id: string) {
    return this.timesheetsService.withdraw(id, req.user.userId, req.user.companyId);
  }

  // Admin endpoints - MUST be before :id routes
  @Get('pending')
  @ApiOperation({ summary: 'Get all pending timesheets (admin)' })
  getPending(@Request() req) {
    return this.timesheetsService.getPendingForCompany(req.user.companyId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get timesheet by ID' })
  getById(@Request() req, @Param('id') id: string) {
    return this.timesheetsService.getById(id, req.user.userId, req.user.companyId);
  }

  @Patch(':id/review')
  @ApiOperation({ summary: 'Approve or reject timesheet (admin)' })
  review(@Request() req, @Param('id') id: string, @Body() dto: ReviewTimesheetDto) {
    return this.timesheetsService.review(id, req.user.userId, req.user.companyId, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a draft timesheet' })
  delete(@Request() req, @Param('id') id: string) {
    return this.timesheetsService.delete(id, req.user.userId, req.user.companyId);
  }
}
