import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class RoleManagementService {
  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
  ) {}

  // ============================================
  // GET TEAM MEMBERS BY ROLE
  // ============================================

  async getTeamByRole(companyId: string) {
    const users = await this.prisma.user.findMany({
      where: { companyId, isActive: true },
      include: {
        managerPermission: true,
        managedLocations: {
          include: { location: { select: { id: true, name: true } } },
        },
        managedWorkers: {
          include: { worker: { select: { id: true, name: true } } },
        },
      },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
    });

    // Group by role
    const grouped = {
      owners: users.filter(u => u.role === 'OWNER'),
      admins: users.filter(u => u.role === 'ADMIN'),
      managers: users.filter(u => u.role === 'MANAGER'),
      workers: users.filter(u => u.role === 'WORKER'),
    };

    return grouped;
  }

  // ============================================
  // CREATE MANAGER/ADMIN DIRECTLY
  // ============================================

  async createManagerOrAdmin(
    companyId: string,
    createdById: string,
    data: {
      name: string;
      email: string;
      phone: string;
      password: string;
      role: 'MANAGER' | 'ADMIN';
    },
  ) {
    const { name, email, phone, password, role } = data;

    // Validate role
    if (role !== 'MANAGER' && role !== 'ADMIN') {
      throw new BadRequestException('Role must be MANAGER or ADMIN');
    }

    // Check email uniqueness
    const existingEmail = await this.prisma.user.findFirst({
      where: { email: email.toLowerCase().trim() },
    });
    if (existingEmail) {
      throw new BadRequestException('Email already in use');
    }

    // Format phone
    let formattedPhone = phone.trim();
    if (!formattedPhone.startsWith('+')) {
      formattedPhone = '+1' + formattedPhone.replace(/\D/g, '');
    }

    // Check phone uniqueness within company
    const existingPhone = await this.prisma.user.findFirst({
      where: { companyId, phone: formattedPhone },
    });
    if (existingPhone) {
      throw new BadRequestException('Phone number already in use in this company');
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create user
    const user = await this.prisma.user.create({
      data: {
        companyId,
        name: name.trim(),
        email: email.toLowerCase().trim(),
        phone: formattedPhone,
        role,
        passwordHash,
        approvalStatus: 'APPROVED',
        isActive: true,
      },
    });

    // Create default permissions for managers
    if (role === 'MANAGER') {
      await this.prisma.managerPermission.create({
        data: {
          userId: user.id,
          companyId,
          // Defaults are set in schema
        },
      });
    }

    // Audit log
    await this.prisma.auditLog.create({
      data: {
        companyId,
        userId: createdById,
        action: 'USER_CREATED',
        targetType: 'User',
        targetId: user.id,
        details: { role, createdAs: 'direct' },
      },
    });

    // Send welcome email
    try {
      await this.emailService.sendWelcomeEmail(
        user.email!,
        user.name,
        role,
      );
    } catch (err) {
      console.error('Failed to send welcome email:', err);
    }

    console.log(`👤 Created ${role}: ${user.name} (${user.email})`);

    return {
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
      },
    };
  }

  // ============================================
  // PROMOTE WORKER TO MANAGER/ADMIN
  // ============================================

  async promoteUser(
    companyId: string,
    promotedById: string,
    data: {
      userId: string;
      newRole: 'MANAGER' | 'ADMIN';
      email: string;
      password: string;
    },
  ) {
    const { userId, newRole, email, password } = data;

    // Get user
    const user = await this.prisma.user.findFirst({
      where: { id: userId, companyId, isActive: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.role === 'OWNER') {
      throw new ForbiddenException('Cannot change owner role');
    }

    if (user.role === newRole) {
      throw new BadRequestException(`User is already a ${newRole}`);
    }

    // Check email uniqueness if different
    if (email.toLowerCase().trim() !== user.email?.toLowerCase()) {
      const existingEmail = await this.prisma.user.findFirst({
        where: { email: email.toLowerCase().trim() },
      });
      if (existingEmail) {
        throw new BadRequestException('Email already in use');
      }
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    const oldRole = user.role;

    // Update user
    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: {
        role: newRole,
        email: email.toLowerCase().trim(),
        passwordHash,
      },
    });

    // Create manager permissions if promoting to manager
    if (newRole === 'MANAGER') {
      const existingPerm = await this.prisma.managerPermission.findUnique({
        where: { userId },
      });
      if (!existingPerm) {
        await this.prisma.managerPermission.create({
          data: {
            userId,
            companyId,
          },
        });
      }
    }

    // Remove manager permissions if promoting from manager to admin
    if (oldRole === 'MANAGER' && newRole === 'ADMIN') {
      await this.prisma.managerPermission.deleteMany({
        where: { userId },
      });
      await this.prisma.managerLocationAssignment.deleteMany({
        where: { managerId: userId },
      });
      await this.prisma.managerWorkerAssignment.deleteMany({
        where: { managerId: userId },
      });
    }

    // Audit log
    await this.prisma.auditLog.create({
      data: {
        companyId,
        userId: promotedById,
        action: 'USER_ROLE_CHANGED',
        targetType: 'User',
        targetId: userId,
        details: { oldRole, newRole },
      },
    });

    // Send notification email
    try {
      await this.emailService.sendRoleChangeEmail(
        updatedUser.email!,
        updatedUser.name,
        newRole,
      );
    } catch (err) {
      console.error('Failed to send role change email:', err);
    }

    console.log(`📈 Promoted ${user.name}: ${oldRole} → ${newRole}`);

    return {
      success: true,
      user: {
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
        role: updatedUser.role,
      },
    };
  }

  // ============================================
  // DEMOTE USER (Back to Worker)
  // ============================================

  async demoteUser(companyId: string, demotedById: string, userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, companyId, isActive: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.role === 'OWNER') {
      throw new ForbiddenException('Cannot demote owner');
    }

    if (user.role === 'WORKER') {
      throw new BadRequestException('User is already a worker');
    }

    const oldRole = user.role;

    // Remove manager permissions and assignments
    await this.prisma.managerPermission.deleteMany({
      where: { userId },
    });
    await this.prisma.managerLocationAssignment.deleteMany({
      where: { managerId: userId },
    });
    await this.prisma.managerWorkerAssignment.deleteMany({
      where: { managerId: userId },
    });

    // Update role
    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: { role: 'WORKER' },
    });

    // Audit log
    await this.prisma.auditLog.create({
      data: {
        companyId,
        userId: demotedById,
        action: 'USER_ROLE_CHANGED',
        targetType: 'User',
        targetId: userId,
        details: { oldRole, newRole: 'WORKER' },
      },
    });

    console.log(`📉 Demoted ${user.name}: ${oldRole} → WORKER`);

    return { success: true };
  }

  // ============================================
  // UPDATE MANAGER PERMISSIONS
  // ============================================

  async updateManagerPermissions(
    companyId: string,
    updatedById: string,
    managerId: string,
    permissions: Partial<{
      canApproveTime: boolean;
      canEditTimePre: boolean;
      canEditTimePost: boolean;
      canDeleteTime: boolean;
      canViewLaborCosts: boolean;
      canViewAllLocations: boolean;
      canViewAllWorkers: boolean;
      canExportPayroll: boolean;
      canViewAnalytics: boolean;
      canGenerateReports: boolean;
      canOnboardWorkers: boolean;
      canDeactivateWorkers: boolean;
      canEditWorkerRates: boolean;
      canCreateShifts: boolean;
      canEditShifts: boolean;
      canDeleteShifts: boolean;
      canApproveShiftSwaps: boolean;
      canApproveTimeOff: boolean;
      canReviewViolations: boolean;
      canWaiveViolations: boolean;
    }>,
  ) {
    // Verify manager exists and is a manager
    const manager = await this.prisma.user.findFirst({
      where: { id: managerId, companyId, role: 'MANAGER', isActive: true },
    });

    if (!manager) {
      throw new NotFoundException('Manager not found');
    }

    // Update or create permissions
    const updated = await this.prisma.managerPermission.upsert({
      where: { userId: managerId },
      update: permissions,
      create: {
        userId: managerId,
        companyId,
        ...permissions,
      },
    });

    // Audit log
    await this.prisma.auditLog.create({
      data: {
        companyId,
        userId: updatedById,
        action: 'MANAGER_PERMISSION_UPDATED',
        targetType: 'User',
        targetId: managerId,
        details: { permissions },
      },
    });

    console.log(`🔧 Updated permissions for ${manager.name}`);

    return { success: true, permissions: updated };
  }

  // ============================================
  // ASSIGN LOCATIONS TO MANAGER
  // ============================================

  async assignLocationsToManager(
    companyId: string,
    assignedById: string,
    managerId: string,
    locationIds: string[],
  ) {
    // Verify manager
    const manager = await this.prisma.user.findFirst({
      where: { id: managerId, companyId, role: 'MANAGER', isActive: true },
    });

    if (!manager) {
      throw new NotFoundException('Manager not found');
    }

    // Remove existing assignments
    await this.prisma.managerLocationAssignment.deleteMany({
      where: { managerId, companyId },
    });

    // Create new assignments
    if (locationIds.length > 0) {
      await this.prisma.managerLocationAssignment.createMany({
        data: locationIds.map(locationId => ({
          managerId,
          locationId,
          companyId,
          assignedBy: assignedById,
        })),
      });
    }

    // Audit log
    await this.prisma.auditLog.create({
      data: {
        companyId,
        userId: assignedById,
        action: 'MANAGER_LOCATION_ASSIGNED',
        targetType: 'User',
        targetId: managerId,
        details: { locationIds },
      },
    });

    console.log(`📍 Assigned ${locationIds.length} locations to ${manager.name}`);

    return { success: true, assignedCount: locationIds.length };
  }

  // ============================================
  // ASSIGN WORKERS TO MANAGER
  // ============================================

  async assignWorkersToManager(
    companyId: string,
    assignedById: string,
    managerId: string,
    workerIds: string[],
  ) {
    // Verify manager
    const manager = await this.prisma.user.findFirst({
      where: { id: managerId, companyId, role: 'MANAGER', isActive: true },
    });

    if (!manager) {
      throw new NotFoundException('Manager not found');
    }

    // Remove existing assignments
    await this.prisma.managerWorkerAssignment.deleteMany({
      where: { managerId, companyId },
    });

    // Create new assignments
    if (workerIds.length > 0) {
      await this.prisma.managerWorkerAssignment.createMany({
        data: workerIds.map(workerId => ({
          managerId,
          workerId,
          companyId,
          assignedBy: assignedById,
        })),
      });
    }

    // Audit log
    await this.prisma.auditLog.create({
      data: {
        companyId,
        userId: assignedById,
        action: 'MANAGER_WORKER_ASSIGNED',
        targetType: 'User',
        targetId: managerId,
        details: { workerIds },
      },
    });

    console.log(`👥 Assigned ${workerIds.length} workers to ${manager.name}`);

    return { success: true, assignedCount: workerIds.length };
  }

  // ============================================
  // GET MANAGER DETAILS (for editing)
  // ============================================

  async getManagerDetails(companyId: string, managerId: string) {
    const manager = await this.prisma.user.findFirst({
      where: { id: managerId, companyId, role: 'MANAGER', isActive: true },
      include: {
        managerPermission: true,
        managedLocations: {
          include: { location: { select: { id: true, name: true } } },
        },
        managedWorkers: {
          include: { worker: { select: { id: true, name: true } } },
        },
      },
    });

    if (!manager) {
      throw new NotFoundException('Manager not found');
    }

    return {
      id: manager.id,
      name: manager.name,
      email: manager.email,
      phone: manager.phone,
      permissions: manager.managerPermission,
      assignedLocations: manager.managedLocations.map(ml => ({
        id: ml.location.id,
        name: ml.location.name,
      })),
      assignedWorkers: manager.managedWorkers.map(mw => ({
        id: mw.worker.id,
        name: mw.worker.name,
      })),
    };
  }
}
