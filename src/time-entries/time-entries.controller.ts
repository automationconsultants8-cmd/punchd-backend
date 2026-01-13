import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards, Request, Res } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery, ApiParam } from '@nestjs/swagger';
import { Response } from 'express';
import { TimeEntriesService } from './time-entries.service';
import { ClockInDto, ClockOutDto } from './dto';
import { ApproveTimeEntryDto, BulkApproveDto, BulkRejectDto } from './dto/approve-time-entry.dto';
import { CreateManualEntryDto } from './dto/create-manual-entry.dto';
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

  @Get('export/excel')
  @ApiOperation({ summary: 'Export time entries to Excel' })
  @ApiQuery({ name: 'startDate', required: false, type: String })
  @ApiQuery({ name: 'endDate', required: false, type: String })
  @ApiQuery({ name: 'userId', required: false, type: String })
  async exportExcel(
    @Request() req,
    @Res() res: Response,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('userId') userId?: string,
  ) {
    const buffer = await this.timeEntriesService.exportToExcel(req.user.companyId, {
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      userId,
    });

    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename=timesheet-${startDate || 'all'}-to-${endDate || 'present'}.xlsx`,
      'Content-Length': buffer.length,
    });

    res.send(buffer);
  }

  @Get('export/pdf')
  @ApiOperation({ summary: 'Export time entries to PDF' })
  @ApiQuery({ name: 'startDate', required: false, type: String })
  @ApiQuery({ name: 'endDate', required: false, type: String })
  @ApiQuery({ name: 'userId', required: false, type: String })
  async exportPdf(
    @Request() req,
    @Res() res: Response,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('userId') userId?: string,
  ) {
    const pdfBuffer = await this.timeEntriesService.exportToPdf(req.user.companyId, {
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      userId,
    });

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename=timesheet-${startDate || 'all'}-to-${endDate || 'present'}.pdf`,
      'Content-Length': pdfBuffer.length,
    });

    res.send(pdfBuffer);
  }

  @Get('export/quickbooks')
  @ApiOperation({ summary: 'Export time entries to QuickBooks format' })
  @ApiQuery({ name: 'startDate', required: false, type: String })
  @ApiQuery({ name: 'endDate', required: false, type: String })
  @ApiQuery({ name: 'format', required: false, enum: ['iif', 'csv'], description: 'Export format (default: csv)' })
  async exportQuickBooks(
    @Request() req,
    @Res() res: Response,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('format') format?: 'iif' | 'csv',
  ) {
    const result = await this.timeEntriesService.exportToQuickBooks(req.user.companyId, {
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      format: format || 'csv',
    });
    @Get('export/csv')
  @ApiOperation({ summary: 'Export time entries to CSV' })
  @ApiQuery({ name: 'startDate', required: false, type: String })
  @ApiQuery({ name: 'endDate', required: false, type: String })
  async exportCsv(
    @Request() req,
    @Res() res: Response,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const result = await this.timeEntriesService.exportToCsv(req.user.companyId, {
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
    });

    res.set({
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename=timesheet-${startDate || 'all'}-to-${endDate || 'present'}.csv`,
      'Content-Length': Buffer.byteLength(result),
    });

    res.send(result);
  }

  @Get('export/adp')
  @ApiOperation({ summary: 'Export time entries to ADP format' })
  @ApiQuery({ name: 'startDate', required: false, type: String })
  @ApiQuery({ name: 'endDate', required: false, type: String })
  async exportAdp(
    @Request() req,
    @Res() res: Response,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const result = await this.timeEntriesService.exportToAdp(req.user.companyId, {
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
    });

    res.set({
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename=adp-timesheet-${startDate || 'all'}-to-${endDate || 'present'}.csv`,
      'Content-Length': Buffer.byteLength(result),
    });

    res.send(result);
  }

  @Get('export/gusto')
  @ApiOperation({ summary: 'Export time entries to Gusto format' })
  @ApiQuery({ name: 'startDate', required: false, type: String })
  @ApiQuery({ name: 'endDate', required: false, type: String })
  async exportGusto(
    @Request() req,
    @Res() res: Response,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const result = await this.timeEntriesService.exportToGusto(req.user.companyId, {
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
    });

    res.set({
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename=gusto-timesheet-${startDate || 'all'}-to-${endDate || 'present'}.csv`,
      'Content-Length': Buffer.byteLength(result),
    });

    res.send(result);
  }

  @Get('export/paychex')
  @ApiOperation({ summary: 'Export time entries to Paychex format' })
  @ApiQuery({ name: 'startDate', required: false, type: String })
  @ApiQuery({ name: 'endDate', required: false, type: String })
  async exportPaychex(
    @Request() req,
    @Res() res: Response,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const result = await this.timeEntriesService.exportToPaychex(req.user.companyId, {
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
    });

    res.set({
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename=paychex-timesheet-${startDate || 'all'}-to-${endDate || 'present'}.csv`,
      'Content-Length': Buffer.byteLength(result),
    });

    res.send(result);
  }

    const extension = format === 'iif' ? 'iif' : 'csv';
    const contentType = format === 'iif' ? 'application/x-iif' : 'text/csv';

    res.set({
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename=quickbooks-timesheet-${startDate || 'all'}-to-${endDate || 'present'}.${extension}`,
      'Content-Length': Buffer.byteLength(result),
    });

    res.send(result);
  }

  @Get('overtime-summary')
  @ApiOperation({ summary: 'Get overtime summary for date range' })
  @ApiQuery({ name: 'startDate', required: false, type: String })
  @ApiQuery({ name: 'endDate', required: false, type: String })
  async getOvertimeSummary(
    @Request() req,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.timeEntriesService.getOvertimeSummary(req.user.companyId, {
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
    });
  }

  @Get()
  @ApiOperation({ summary: 'Get time entries with filters' })
  @ApiQuery({ name: 'userId', required: false, type: String })
  @ApiQuery({ name: 'jobId', required: false, type: String })
  @ApiQuery({ name: 'startDate', required: false, type: String })
  @ApiQuery({ name: 'endDate', required: false, type: String })
  @ApiQuery({ name: 'entryType', required: false, enum: ['JOB_TIME', 'TRAVEL_TIME'] })
  @ApiQuery({ name: 'approvalStatus', required: false, enum: ['PENDING', 'APPROVED', 'REJECTED'] })
  getTimeEntries(
    @Request() req,
    @Query('userId') userId?: string,
    @Query('jobId') jobId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('entryType') entryType?: 'JOB_TIME' | 'TRAVEL_TIME',
    @Query('approvalStatus') approvalStatus?: 'PENDING' | 'APPROVED' | 'REJECTED',
  ) {
    return this.timeEntriesService.getTimeEntries(req.user.companyId, {
      userId,
      jobId,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      entryType,
      approvalStatus,
    });
  }

  @Get('pending')
  @ApiOperation({ summary: 'Get all pending time entries for approval' })
  getPendingApprovals(@Request() req) {
    return this.timeEntriesService.getPendingApprovals(req.user.companyId);
  }

  @Get('approval-stats')
  @ApiOperation({ summary: 'Get approval statistics' })
  getApprovalStats(@Request() req) {
    return this.timeEntriesService.getApprovalStats(req.user.companyId);
  }

  @Patch(':id/approve')
  @ApiOperation({ summary: 'Approve a time entry' })
  @ApiParam({ name: 'id', description: 'Time entry ID' })
  approveEntry(
    @Request() req,
    @Param('id') id: string,
  ) {
    return this.timeEntriesService.approveEntry(id, req.user.userId, req.user.companyId);
  }

  @Patch(':id/reject')
  @ApiOperation({ summary: 'Reject a time entry' })
  @ApiParam({ name: 'id', description: 'Time entry ID' })
  rejectEntry(
    @Request() req,
    @Param('id') id: string,
    @Body() dto: ApproveTimeEntryDto,
  ) {
    return this.timeEntriesService.rejectEntry(id, req.user.userId, req.user.companyId, dto.rejectionReason);
  }

  @Post('bulk-approve')
  @ApiOperation({ summary: 'Approve multiple time entries at once' })
  bulkApprove(
    @Request() req,
    @Body() dto: BulkApproveDto,
  ) {
    return this.timeEntriesService.bulkApprove(dto.entryIds, req.user.userId, req.user.companyId);
  }

  @Post('bulk-reject')
  @ApiOperation({ summary: 'Reject multiple time entries at once' })
  bulkReject(
    @Request() req,
    @Body() dto: BulkRejectDto,
  ) {
    return this.timeEntriesService.bulkReject(dto.entryIds, req.user.userId, req.user.companyId, dto.rejectionReason);
  }

  @Post('manual')
  @ApiOperation({ summary: 'Create a manual time entry' })
  createManualEntry(
    @Request() req,
    @Body() dto: CreateManualEntryDto,
  ) {
    return this.timeEntriesService.createManualEntry(req.user.companyId, req.user.userId, dto);
  }
}
