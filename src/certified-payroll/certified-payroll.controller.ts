import { Controller, Get, Post, Body, Param, Query, UseGuards, Request, Res } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { Response } from 'express';
import { CertifiedPayrollService, PayrollPreviewData } from './certified-payroll.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Certified Payroll')
@Controller('certified-payroll')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class CertifiedPayrollController {
  constructor(private readonly certifiedPayrollService: CertifiedPayrollService) {}

  @Get('jobs')
  @ApiOperation({ summary: 'Get prevailing wage jobs' })
  getPrevailingWageJobs(@Request() req) {
    return this.certifiedPayrollService.getPrevailingWageJobs(req.user.companyId);
  }

  @Get('preview')
  @ApiOperation({ summary: 'Preview payroll data before generating' })
  @ApiQuery({ name: 'jobId', required: true })
  @ApiQuery({ name: 'weekEndingDate', required: true })
  previewPayroll(
    @Request() req,
    @Query('jobId') jobId: string,
    @Query('weekEndingDate') weekEndingDate: string,
  ): Promise<PayrollPreviewData> {
    return this.certifiedPayrollService.generatePayrollData(
      req.user.companyId,
      jobId,
      new Date(weekEndingDate),
    );
  }

  @Post('generate')
  @ApiOperation({ summary: 'Generate certified payroll report' })
  generatePayroll(
    @Request() req,
    @Body() body: { jobId: string; weekEndingDate: string },
  ) {
    return this.certifiedPayrollService.createOrUpdatePayroll(
      req.user.companyId,
      body.jobId,
      new Date(body.weekEndingDate),
      req.user.userId,
    );
  }

  @Get()
  @ApiOperation({ summary: 'Get all certified payrolls' })
  @ApiQuery({ name: 'jobId', required: false })
  @ApiQuery({ name: 'status', required: false })
  getPayrolls(
    @Request() req,
    @Query('jobId') jobId?: string,
    @Query('status') status?: string,
  ) {
    return this.certifiedPayrollService.getPayrolls(req.user.companyId, { jobId, status });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get payroll by ID' })
  getPayrollById(@Request() req, @Param('id') id: string) {
    return this.certifiedPayrollService.getPayrollById(req.user.companyId, id);
  }

  @Post(':id/submit')
  @ApiOperation({ summary: 'Submit payroll' })
  submitPayroll(@Request() req, @Param('id') id: string) {
    return this.certifiedPayrollService.submitPayroll(req.user.companyId, id, req.user.userId);
  }

  @Get(':id/pdf')
  @ApiOperation({ summary: 'Download payroll as PDF' })
  async downloadPDF(
    @Request() req,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const payroll = await this.certifiedPayrollService.getPayrollById(req.user.companyId, id);
    const buffer = await this.certifiedPayrollService.generatePDF(req.user.companyId, id);

    const filename = `WH-347_${payroll.job.name}_${new Date(payroll.weekEndingDate).toISOString().split('T')[0]}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }
}
