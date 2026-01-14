import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards, Request, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PayPeriodsService } from './pay-periods.service';

@ApiTags('Pay Periods')
@Controller('pay-periods')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class PayPeriodsController {
  constructor(private readonly payPeriodsService: PayPeriodsService) {}

  // Only Owner and Admin can access pay periods
  private checkAccess(req: any) {
    if (req.user.role !== 'OWNER' && req.user.role !== 'ADMIN') {
      throw new ForbiddenException('Only owners and admins can manage pay periods');
    }
  }

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
  @ApiOperation({ summary: 'Get current pay period (creates if not exists)' })
  async getCurrentPayPeriod(@Request() req) {
    this.checkAccess(req);
    return this.payPeriodsService.getCurrentPayPeriod(req.user.companyId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new pay period' })
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
  @ApiOperation({ summary: 'Get pay period details with entries' })
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

  @Post(':id/export')
  @ApiOperation({ summary: 'Mark pay period as exported' })
  async markAsExported(@Request() req, @Param('id') id: string) {
    this.checkAccess(req);
    return this.payPeriodsService.markAsExported(
      req.user.companyId,
      req.user.userId,
      id,
    );
  }
}
