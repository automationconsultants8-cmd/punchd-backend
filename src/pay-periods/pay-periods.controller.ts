import { Controller, Get, Post, Patch, Body, Param, Query, Res, UseGuards, Request, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PayPeriodsService } from './pay-periods.service';
import { Controller, Get, Post, Patch, Delete, Body, Param, Query, Res, UseGuards, Request, ForbiddenException } from '@nestjs/common';

@ApiTags('Pay Periods')
@Controller('pay-periods')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class PayPeriodsController {
  constructor(private readonly payPeriodsService: PayPeriodsService) {}

  private checkAccess(req: any) {
    if (req.user.role !== 'OWNER' && req.user.role !== 'ADMIN') {
      throw new ForbiddenException('Only owners and admins can manage pay periods');
    }
  }

  // ============================================
  // SETTINGS
  // ============================================

  @Get('settings')
  @ApiOperation({ summary: 'Get pay period settings' })
  async getSettings(@Request() req) {
    this.checkAccess(req);
    return this.payPeriodsService.getSettings(req.user.companyId);
  }

  @Patch('settings')
  @ApiOperation({ summary: 'Configure recurring pay periods' })
  async configureSettings(
    @Request() req,
    @Body() body: {
      payPeriodType: 'WEEKLY' | 'BIWEEKLY' | 'SEMIMONTHLY' | 'MONTHLY' | 'CUSTOM';
      payPeriodStartDay?: number;
      payPeriodAnchorDate?: string;
      customPayPeriodDays?: number;
    },
  ) {
    this.checkAccess(req);
    return this.payPeriodsService.configureSettings(
      req.user.companyId,
      req.user.userId,
      body,
    );
  }

  // ============================================
  // PAY PERIODS
  // ============================================

  @Get()
  @ApiOperation({ summary: 'Get all pay periods' })
  @ApiQuery({ name: 'status', required: false, enum: ['OPEN', 'LOCKED', 'EXPORTED'] })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getPayPeriods(
    @Request() req,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    this.checkAccess(req);
    return this.payPeriodsService.getPayPeriods(req.user.companyId, {
      status,
      limit: limit ? parseInt(limit) : undefined,
    });
  }

  @Get('current')
  @ApiOperation({ summary: 'Get current pay period' })
  async getCurrentPayPeriod(@Request() req) {
    this.checkAccess(req);
    return this.payPeriodsService.getCurrentPayPeriod(req.user.companyId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a manual pay period' })
  async createPayPeriod(
    @Request() req,
    @Body() body: { startDate: string; endDate: string },
  ) {
    this.checkAccess(req);
    return this.payPeriodsService.createPayPeriod(
      req.user.companyId,
      req.user.userId,
      {
        startDate: new Date(body.startDate),
        endDate: new Date(body.endDate),
      },
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get pay period details' })
  async getPayPeriodDetails(@Request() req, @Param('id') id: string) {
    this.checkAccess(req);
    return this.payPeriodsService.getPayPeriodDetails(req.user.companyId, id);
  }

  @Post(':id/lock')
  @ApiOperation({ summary: 'Lock a pay period' })
  async lockPayPeriod(@Request() req, @Param('id') id: string) {
    this.checkAccess(req);
    return this.payPeriodsService.lockPayPeriod(
      req.user.companyId,
      req.user.userId,
      id,
      req.user.role,
    );
  }

  @Post(':id/unlock')
  @ApiOperation({ summary: 'Unlock a pay period (Owner only)' })
  async unlockPayPeriod(
    @Request() req,
    @Param('id') id: string,
    @Body() body: { reason: string },
  ) {
    this.checkAccess(req);
    return this.payPeriodsService.unlockPayPeriod(
      req.user.companyId,
      req.user.userId,
      id,
      req.user.role,
      body.reason,
    );
  }

  @Post(':id/mark-exported')
  @ApiOperation({ summary: 'Mark pay period as exported' })
  async markAsExported(@Request() req, @Param('id') id: string) {
    this.checkAccess(req);
    return this.payPeriodsService.markAsExported(
      req.user.companyId,
      req.user.userId,
      id,
    );
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a pay period' })
  async deletePayPeriod(@Request() req, @Param('id') id: string) {
    if (req.user.role !== 'OWNER') {
      throw new ForbiddenException('Only owners can delete pay periods');
    }
    return this.payPeriodsService.deletePayPeriod(
      req.user.companyId,
      req.user.userId,
      id,
    );
  }

  // ============================================
  // EXPORT
  // ============================================

  @Get(':id/export')
  @ApiOperation({ summary: 'Export pay period data' })
  @ApiQuery({ name: 'format', required: false, enum: ['CSV', 'JSON'] })
  async exportPayPeriod(
    @Request() req,
    @Res() res: Response,
    @Param('id') id: string,
    @Query('format') format: string = 'CSV',
  ) {
    this.checkAccess(req);
    
    const data = await this.payPeriodsService.exportPayPeriod(req.user.companyId, id, format);

    if (format.toUpperCase() === 'JSON') {
      return res.json(data);
    }

    // Generate CSV
    const csvRows: string[] = [];
    
    // Header
    csvRows.push('Employee,Date,Clock In,Clock Out,Job Site,Regular Hours,Overtime Hours,Double Time Hours,Total Hours,Hourly Rate,Total Pay,Status');
    
    // Data rows
    data.entries.forEach((entry: any) => {
      csvRows.push([
        `"${entry.employeeName}"`,
        entry.date,
        entry.clockIn,
        entry.clockOut,
        `"${entry.jobSite}"`,
        entry.regularHours,
        entry.overtimeHours,
        entry.doubleTimeHours,
        entry.totalHours,
        entry.hourlyRate,
        entry.totalPay,
        entry.status,
      ].join(','));
    });

    // Summary row
    csvRows.push('');
    csvRows.push(`"SUMMARY",,,,,${(data.summary.regularMinutes / 60).toFixed(2)},${(data.summary.overtimeMinutes / 60).toFixed(2)},${(data.summary.doubleTimeMinutes / 60).toFixed(2)},${(data.summary.totalMinutes / 60).toFixed(2)},,${data.summary.totalPay.toFixed(2)},`);

    const csv = csvRows.join('\n');
    
    const startDate = new Date(data.payPeriod.startDate).toISOString().split('T')[0];
    const endDate = new Date(data.payPeriod.endDate).toISOString().split('T')[0];
    const filename = `payroll-${startDate}-to-${endDate}.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  }
}
