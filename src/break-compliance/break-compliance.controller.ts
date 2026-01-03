import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { BreakComplianceService } from './break-compliance.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Break Compliance')
@Controller('break-compliance')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class BreakComplianceController {
  constructor(private readonly breakComplianceService: BreakComplianceService) {}

  @Get('settings')
  @ApiOperation({ summary: 'Get company break compliance settings' })
  getSettings(@Request() req) {
    return this.breakComplianceService.getComplianceSettings(req.user.companyId);
  }

  @Patch('settings')
  @ApiOperation({ summary: 'Update company break compliance settings' })
  updateSettings(@Request() req, @Body() settings: any) {
    return this.breakComplianceService.updateCompanySettings(req.user.companyId, settings, req.user.userId);
  }

  @Get('violations')
  @ApiOperation({ summary: 'Get break violations' })
  @ApiQuery({ name: 'userId', required: false })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  @ApiQuery({ name: 'waived', required: false })
  getViolations(
    @Request() req,
    @Query('userId') userId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('waived') waived?: string,
  ) {
    return this.breakComplianceService.getViolations(req.user.companyId, {
      userId,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      waived: waived === 'true' ? true : waived === 'false' ? false : undefined,
    });
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get compliance statistics' })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  getStats(
    @Request() req,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.breakComplianceService.getComplianceStats(
      req.user.companyId,
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
    );
  }

  @Patch('violations/:id/waive')
  @ApiOperation({ summary: 'Waive a break violation' })
  waiveViolation(
    @Request() req,
    @Param('id') id: string,
    @Body() body: { reason: string },
  ) {
    return this.breakComplianceService.waiveViolation(id, req.user.userId, req.user.companyId, body.reason);
  }
}
