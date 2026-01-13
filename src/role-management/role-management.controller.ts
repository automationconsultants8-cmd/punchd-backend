import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, Request, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RoleManagementService } from './role-management.service';

@ApiTags('Role Management')
@Controller('role-management')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class RoleManagementController {
  constructor(private readonly roleManagementService: RoleManagementService) {}

  // Only Owner and Admin can access these endpoints
  private checkAccess(req: any) {
    if (req.user.role !== 'OWNER' && req.user.role !== 'ADMIN') {
      throw new ForbiddenException('Only owners and admins can manage roles');
    }
  }

  @Get('team')
  @ApiOperation({ summary: 'Get all team members grouped by role' })
  async getTeamByRole(@Request() req) {
    this.checkAccess(req);
    return this.roleManagementService.getTeamByRole(req.user.companyId);
  }

  @Post('create')
  @ApiOperation({ summary: 'Create a new manager or admin directly' })
  async createManagerOrAdmin(
    @Request() req,
    @Body() body: {
      name: string;
      email: string;
      phone: string;
      password: string;
      role: 'MANAGER' | 'ADMIN';
    },
  ) {
    this.checkAccess(req);
    
    // Only owners can create admins
    if (body.role === 'ADMIN' && req.user.role !== 'OWNER') {
      throw new ForbiddenException('Only owners can create admins');
    }
    
    return this.roleManagementService.createManagerOrAdmin(
      req.user.companyId,
      req.user.userId,
      body,
    );
  }

  @Post('promote')
  @ApiOperation({ summary: 'Promote a worker to manager or admin' })
  async promoteUser(
    @Request() req,
    @Body() body: {
      userId: string;
      newRole: 'MANAGER' | 'ADMIN';
      email: string;
      password: string;
    },
  ) {
    this.checkAccess(req);
    
    // Only owners can promote to admin
    if (body.newRole === 'ADMIN' && req.user.role !== 'OWNER') {
      throw new ForbiddenException('Only owners can create admins');
    }
    
    return this.roleManagementService.promoteUser(
      req.user.companyId,
      req.user.userId,
      body,
    );
  }

  @Post('demote/:userId')
  @ApiOperation({ summary: 'Demote a manager or admin back to worker' })
  async demoteUser(@Request() req, @Param('userId') userId: string) {
    this.checkAccess(req);
    return this.roleManagementService.demoteUser(
      req.user.companyId,
      req.user.userId,
      userId,
    );
  }

  @Get('manager/:managerId')
  @ApiOperation({ summary: 'Get manager details including permissions and assignments' })
  async getManagerDetails(@Request() req, @Param('managerId') managerId: string) {
    this.checkAccess(req);
    return this.roleManagementService.getManagerDetails(req.user.companyId, managerId);
  }

  @Patch('manager/:managerId/permissions')
  @ApiOperation({ summary: 'Update manager permissions' })
  async updateManagerPermissions(
    @Request() req,
    @Param('managerId') managerId: string,
    @Body() permissions: {
      canApproveTime?: boolean;
      canEditTimePre?: boolean;
      canEditTimePost?: boolean;
      canDeleteTime?: boolean;
      canViewLaborCosts?: boolean;
      canViewAllLocations?: boolean;
      canViewAllWorkers?: boolean;
      canExportPayroll?: boolean;
      canViewAnalytics?: boolean;
      canGenerateReports?: boolean;
      canOnboardWorkers?: boolean;
      canDeactivateWorkers?: boolean;
      canEditWorkerRates?: boolean;
      canCreateShifts?: boolean;
      canEditShifts?: boolean;
      canDeleteShifts?: boolean;
      canApproveShiftSwaps?: boolean;
      canApproveTimeOff?: boolean;
      canReviewViolations?: boolean;
      canWaiveViolations?: boolean;
    },
  ) {
    this.checkAccess(req);
    return this.roleManagementService.updateManagerPermissions(
      req.user.companyId,
      req.user.userId,
      managerId,
      permissions,
    );
  }

  @Patch('manager/:managerId/locations')
  @ApiOperation({ summary: 'Assign locations to a manager' })
  async assignLocations(
    @Request() req,
    @Param('managerId') managerId: string,
    @Body() body: { locationIds: string[] },
  ) {
    this.checkAccess(req);
    return this.roleManagementService.assignLocationsToManager(
      req.user.companyId,
      req.user.userId,
      managerId,
      body.locationIds,
    );
  }

  @Patch('manager/:managerId/workers')
  @ApiOperation({ summary: 'Assign workers to a manager' })
  async assignWorkers(
    @Request() req,
    @Param('managerId') managerId: string,
    @Body() body: { workerIds: string[] },
  ) {
    this.checkAccess(req);
    return this.roleManagementService.assignWorkersToManager(
      req.user.companyId,
      req.user.userId,
      managerId,
      body.workerIds,
    );
  }
}
