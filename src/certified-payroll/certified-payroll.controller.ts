import { Controller, Get, Post, Query, Param, UseGuards, Request, Res, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { FeatureGuard } from '../features/feature.guard';
import { RequiresFeature } from '../features/feature.decorator';
import { CertifiedPayrollService } from './certified-payroll.service';

@ApiTags('Certified Payroll / Reports')
@Controller('certified-payroll')
@UseGuards(JwtAuthGuard, FeatureGuard)
@ApiBearerAuth()
export class CertifiedPayrollController {
  constructor(private readonly service: CertifiedPayrollService) {}

  // ============================================
  // JOBS
  // ============================================

  @Get('jobs')
  @RequiresFeature('CERTIFIED_PAYROLL')
  @ApiOperation({ summary: 'Get jobs for reports (all or prevailing wage only)' })
  @ApiQuery({ name: 'prevailingWageOnly', required: false, type: Boolean })
  getJobs(
    @Request() req,
    @Query('prevailingWageOnly') prevailingWageOnly?: string,
  ) {
    return this.service.getJobs(req.user.companyId, prevailingWageOnly === 'true');
  }

  // ============================================
  // CLIENT BILLING REPORT
  // ============================================

  @Get('client-billing/preview')
  @RequiresFeature('CERTIFIED_PAYROLL')
  @ApiOperation({ summary: 'Preview client billing report' })
  @ApiQuery({ name: 'jobId', required: false })
  @ApiQuery({ name: 'startDate', required: true })
  @ApiQuery({ name: 'endDate', required: true })
  @ApiQuery({ name: 'billRate', required: false })
  previewClientBilling(
    @Request() req,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('jobId') jobId?: string,
    @Query('billRate') billRate?: string,
  ) {
    return this.service.generateClientBillingReport(req.user.companyId, req.user.userId, {
      jobId,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      billRate: billRate ? parseFloat(billRate) : undefined,
    });
  }

  @Get('client-billing/pdf')
  @RequiresFeature('CERTIFIED_PAYROLL')
  @ApiOperation({ summary: 'Download client billing report as PDF' })
  @ApiQuery({ name: 'jobId', required: false })
  @ApiQuery({ name: 'startDate', required: true })
  @ApiQuery({ name: 'endDate', required: true })
  @ApiQuery({ name: 'billRate', required: false })
  async downloadClientBillingPDF(
    @Request() req,
    @Res() res: Response,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('jobId') jobId?: string,
    @Query('billRate') billRate?: string,
  ) {
    const pdf = await this.service.generateClientBillingPDF(req.user.companyId, req.user.userId, {
      jobId,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      billRate: billRate ? parseFloat(billRate) : undefined,
    });

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename=client-billing-${startDate}-to-${endDate}.pdf`,
      'Content-Length': pdf.length,
    });
    res.send(pdf);
  }

  // ============================================
  // WORKER SUMMARY REPORT
  // ============================================

  @Get('worker-summary/preview')
  @RequiresFeature('CERTIFIED_PAYROLL')
  @ApiOperation({ summary: 'Preview worker summary report' })
  @ApiQuery({ name: 'workerId', required: false })
  @ApiQuery({ name: 'jobId', required: false })
  @ApiQuery({ name: 'startDate', required: true })
  @ApiQuery({ name: 'endDate', required: true })
  previewWorkerSummary(
    @Request() req,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('workerId') workerId?: string,
    @Query('jobId') jobId?: string,
  ) {
    return this.service.generateWorkerSummaryReport(req.user.companyId, req.user.userId, {
      workerId,
      jobId,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
    });
  }

  @Get('worker-summary/pdf')
  @RequiresFeature('CERTIFIED_PAYROLL')
  @ApiOperation({ summary: 'Download worker summary report as PDF' })
  @ApiQuery({ name: 'workerId', required: false })
  @ApiQuery({ name: 'jobId', required: false })
  @ApiQuery({ name: 'startDate', required: true })
  @ApiQuery({ name: 'endDate', required: true })
  async downloadWorkerSummaryPDF(
    @Request() req,
    @Res() res: Response,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('workerId') workerId?: string,
    @Query('jobId') jobId?: string,
  ) {
    const pdf = await this.service.generateWorkerSummaryPDF(req.user.companyId, req.user.userId, {
      workerId,
      jobId,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
    });

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename=worker-summary-${startDate}-to-${endDate}.pdf`,
      'Content-Length': pdf.length,
    });
    res.send(pdf);
  }

  // ============================================
  // WH-347 CERTIFIED PAYROLL
  // ============================================

  @Get('wh347/jobs')
  @RequiresFeature('CERTIFIED_PAYROLL')
  @ApiOperation({ summary: 'Get prevailing wage jobs for WH-347' })
  getWH347Jobs(@Request() req) {
    return this.service.getWH347Jobs(req.user.companyId);
  }

  @Get('wh347/preview')
  @RequiresFeature('CERTIFIED_PAYROLL')
  @ApiOperation({ summary: 'Preview WH-347 certified payroll' })
  @ApiQuery({ name: 'jobId', required: true })
  @ApiQuery({ name: 'weekEndingDate', required: true })
  previewWH347(
    @Request() req,
    @Query('jobId') jobId: string,
    @Query('weekEndingDate') weekEndingDate: string,
  ) {
    return this.service.previewWH347(req.user.companyId, jobId, new Date(weekEndingDate));
  }

  @Post('wh347/generate')
  @RequiresFeature('CERTIFIED_PAYROLL')
  @ApiOperation({ summary: 'Generate WH-347 certified payroll' })
  generateWH347(
    @Request() req,
    @Body() body: { jobId: string; weekEndingDate: string },
  ) {
    return this.service.generateWH347(
      req.user.companyId,
      req.user.userId,
      body.jobId,
      new Date(body.weekEndingDate),
    );
  }

  @Get('wh347/:id/pdf')
  @RequiresFeature('CERTIFIED_PAYROLL')
  @ApiOperation({ summary: 'Download WH-347 PDF' })
  async downloadWH347PDF(
    @Request() req,
    @Res() res: Response,
    @Param('id') id: string,
  ) {
    const pdf = await this.service.generateWH347PDF(id, req.user.companyId);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename=WH-347_${id}.pdf`,
      'Content-Length': pdf.length,
    });
    res.send(pdf);
  }

  @Post('wh347/:id/submit')
  @RequiresFeature('CERTIFIED_PAYROLL')
  @ApiOperation({ summary: 'Mark WH-347 as submitted' })
  submitWH347(
    @Request() req,
    @Param('id') id: string,
  ) {
    return this.service.submitPayroll(id, req.user.companyId, req.user.userId);
  }

  // ============================================
  // HISTORY
  // ============================================

  @Get('history')
  @RequiresFeature('CERTIFIED_PAYROLL')
  @ApiOperation({ summary: 'Get certified payroll history' })
  getHistory(@Request() req) {
    return this.service.getPayrollHistory(req.user.companyId);
  }
}
