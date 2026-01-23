import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { LeaveService } from './leave.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { LeaveType } from '@prisma/client';
import { SettingsGuard, RequireSetting } from '../common/settings.guard';

@ApiTags('leave')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, SettingsGuard)
@RequireSetting('leaveManagement')
@Controller('leave')
export class LeaveController {
  constructor(private readonly leaveService: LeaveService) {}

  @Get('policies')
  @ApiOperation({ summary: 'Get all leave policies for company' })
  async getPolicies(@Request() req) {
    return this.leaveService.getPolicies(req.user.companyId);
  }

  @Post('policies')
  @ApiOperation({ summary: 'Create a new leave policy' })
  async createPolicy(
    @Request() req,
    @Body() body: {
      name: string;
      type: LeaveType;
      annualHours: number;
      accrualRate?: number;
      maxCarryover?: number;
    },
  ) {
    return this.leaveService.createPolicy(req.user.companyId, req.user.userId, body);
  }

  @Patch('policies/:id')
  @ApiOperation({ summary: 'Update a leave policy' })
  async updatePolicy(
    @Request() req,
    @Param('id') id: string,
    @Body() body: {
      name?: string;
      annualHours?: number;
      accrualRate?: number;
      maxCarryover?: number;
      isActive?: boolean;
    },
  ) {
    return this.leaveService.updatePolicy(id, req.user.companyId, req.user.userId, body);
  }

  @Delete('policies/:id')
  @ApiOperation({ summary: 'Delete a leave policy' })
  async deletePolicy(@Request() req, @Param('id') id: string) {
    return this.leaveService.deletePolicy(id, req.user.companyId, req.user.userId);
  }

  @Post('policies/:id/apply-to-all')
  @ApiOperation({ summary: 'Apply policy to all workers' })
  async applyPolicyToAll(@Request() req, @Param('id') id: string) {
    return this.leaveService.applyPolicyToAllWorkers(id, req.user.companyId, req.user.userId);
  }

  @Get('balances')
  @ApiOperation({ summary: 'Get leave balances' })
  async getBalances(
    @Request() req,
    @Query('userId') userId?: string,
    @Query('policyId') policyId?: string,
  ) {
    return this.leaveService.getBalances(req.user.companyId, { userId, policyId });
  }

  @Get('balances/worker/:userId')
  @ApiOperation({ summary: 'Get balances for a specific worker' })
  async getWorkerBalances(@Request() req, @Param('userId') userId: string) {
    return this.leaveService.getWorkerBalances(userId, req.user.companyId);
  }

  @Patch('balances/:id')
  @ApiOperation({ summary: 'Update a leave balance' })
  async updateBalance(
    @Request() req,
    @Param('id') id: string,
    @Body() body: {
      totalHours?: number;
      usedHours?: number;
    },
  ) {
    return this.leaveService.updateBalance(id, req.user.companyId, req.user.userId, body);
  }

  @Get('summary')
  @ApiOperation({ summary: 'Get leave summary for all workers' })
  async getWorkersSummary(@Request() req) {
    return this.leaveService.getWorkersSummary(req.user.companyId);
  }
}
