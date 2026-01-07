import { Controller, Get, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { FeatureGuard } from '../features/feature.guard';
import { RequiresFeature } from '../features/feature.decorator';
import { AuditService } from './audit.service';

@ApiTags('Audit')
@Controller('audit')
@UseGuards(JwtAuthGuard, FeatureGuard)
@ApiBearerAuth()
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @RequireFeature('AUDIT_LOGS')
  @ApiOperation({ summary: 'Get audit logs for company' })
  @ApiQuery({ name: 'action', required: false, description: 'Filter by action type' })
  @ApiQuery({ name: 'limit', required: false, description: 'Number of entries to return' })
  async getAuditLogs(
    @Request() req,
    @Query('action') action?: string,
    @Query('limit') limit?: string,
  ) {
    return this.auditService.getAuditLogs(req.user.companyId, {
      action: action as any,
      limit: limit ? parseInt(limit) : 50,
    });
  }
}
