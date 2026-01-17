import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { LeaveService } from './leave.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { LeaveType } from '@prisma/client';

@ApiTags('Leave Management')
@Controller('leave')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class LeaveController {
  constructor(private readonly leaveService: LeaveService) {}

  // ============================================
  // POLICIES
  // ============================================

  @Get('policies')
  @ApiOperation({ summary: 'Get all leave policies for company' })
  getPolicies(@Request() req) {
    return this.leaveService.getPolicies(req.user.companyId);
  }

  @Post('policies')
  @ApiOperation({ summary: 'Create a new leave policy' })
  createPolicy(
    @Request() req,
    @Body() body: {
      leaveType: LeaveType;
      name: string;
      hoursPerYear: number;
      accrualRate?: number;
      maxCarryover?: number;
      maxBalance?: number;
    },
  ) {
    return this.leaveService.createPolicy(req.user.companyId, body);
  }

  @Patch('policies/:id')
  @ApiOperation({ summary: 'Update a leave policy' })
  updatePolicy(
    @Request() req,
    @Param('id') id: string,
    @Body() body: {
      name?: string;
      hoursPerYear?: number;
      accrualRate?: number;
      maxCarryover?: number;
      maxBalance?: number;
      isActive?: boolean;
    },
  ) {
    return this.leaveService.updatePolicy(req.user.companyId, id, body);
  }

  @Delete('policies/:id')
  @ApiOperation({ summary: 'Delete a leave policy' })
  deletePolicy(@Request() req, @Param('id') id: string) {
    return this.leaveService.deletePolicy(req.user.companyId, id);
  }

  @Post('policies/:id/apply-all')
  @ApiOperation({ summary: 'Apply policy to all active workers' })
  applyPolicyToAll(@Request() req, @Param('id') id: string) {
    return this.leaveService.applyPolicyToAllWorkers(req.user.companyId, id, req.user.userId);
  }

  // ============================================
  // BALANCES
  // ============================================

  @Get('balances')
  @ApiOperation({ summary: 'Get all leave balances' })
  getBalances(@Request() req, @Query('userId') userId?: string) {
    return this.leaveService.getBalances(req.user.companyId, userId);
  }

  @Get('balances/summary')
  @ApiOperation({ summary: 'Get workers summary with leave balances' })
  getWorkersSummary(@Request() req) {
    return this.leaveService.getWorkersSummary(req.user.companyId);
  }

  @Get('balances/worker/:userId')
  @ApiOperation({ summary: 'Get leave balances for a specific worker' })
  getWorkerBalances(@Request() req, @Param('userId') userId: string) {
    return this.leaveService.getWorkerBalances(req.user.companyId, userId);
  }

  @Patch('balances/:id')
  @ApiOperation({ summary: 'Update a leave balance' })
  updateBalance(
    @Request() req,
    @Param('id') id: string,
    @Body() body: {
      totalHours?: number;
      usedHours?: number;
      notes?: string;
    },
  ) {
    return this.leaveService.updateBalance(req.user.companyId, id, req.user.userId, body);
  }

  @Post('balances/set')
  @ApiOperation({ summary: 'Set leave balance for a worker (create or update)' })
  setWorkerBalance(
    @Request() req,
    @Body() body: {
      userId: string;
      leaveType: LeaveType;
      totalHours: number;
      usedHours?: number;
      notes?: string;
    },
  ) {
    return this.leaveService.setWorkerBalance(
      req.user.companyId,
      body.userId,
      body.leaveType,
      req.user.userId,
      body,
    );
  }

  // ============================================
  // BULK OPERATIONS
  // ============================================

  @Post('bulk/apply-to-worker/:userId')
  @ApiOperation({ summary: 'Apply all active policies to a worker' })
  applyAllPoliciesToWorker(@Request() req, @Param('userId') userId: string) {
    return this.leaveService.applyAllPoliciesToWorker(req.user.companyId, userId, req.user.userId);
  }

  @Post('bulk/apply-all')
  @ApiOperation({ summary: 'Apply all policies to all workers' })
  applyAllPoliciesToAllWorkers(@Request() req) {
    return this.leaveService.applyAllPoliciesToAllWorkers(req.user.companyId, req.user.userId);
  }
}
