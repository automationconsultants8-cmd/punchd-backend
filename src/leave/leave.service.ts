import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { LeaveType } from '@prisma/client';

@Injectable()
export class LeaveService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
  ) {}

  // ============================================
  // POLICIES
  // ============================================

  async getPolicies(companyId: string) {
    return this.prisma.leavePolicy.findMany({
      where: { companyId },
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { balances: true } },
      },
    });
  }

  async createPolicy(companyId: string, userId: string, data: {
    name: string;
    type: LeaveType;
    annualHours: number;
    accrualRate?: number;
    maxCarryover?: number;
  }) {
    const policy = await this.prisma.leavePolicy.create({
      data: {
        companyId,
        name: data.name,
        type: data.type,
        annualHours: data.annualHours,
        accrualRate: data.accrualRate ?? null,
        maxCarryover: data.maxCarryover ?? null,
      },
    });

    await this.auditService.log({
      companyId,
      userId,
      action: 'LEAVE_POLICY_CREATED',
      targetType: 'LEAVE_POLICY',
      targetId: policy.id,
      details: { name: data.name, type: data.type, annualHours: data.annualHours },
    });

    return policy;
  }

  async updatePolicy(policyId: string, companyId: string, userId: string, data: {
    name?: string;
    annualHours?: number;
    accrualRate?: number;
    maxCarryover?: number;
    isActive?: boolean;
  }) {
    const policy = await this.prisma.leavePolicy.findFirst({
      where: { id: policyId, companyId },
    });

    if (!policy) {
      throw new NotFoundException('Leave policy not found');
    }

    const updated = await this.prisma.leavePolicy.update({
      where: { id: policyId },
      data: {
        name: data.name,
        annualHours: data.annualHours,
        accrualRate: data.accrualRate,
        maxCarryover: data.maxCarryover,
        isActive: data.isActive,
      },
    });

    await this.auditService.log({
      companyId,
      userId,
      action: 'LEAVE_POLICY_UPDATED',
      targetType: 'LEAVE_POLICY',
      targetId: policyId,
      details: { changes: data },
    });

    return updated;
  }

  async deletePolicy(policyId: string, companyId: string, userId: string) {
    const policy = await this.prisma.leavePolicy.findFirst({
      where: { id: policyId, companyId },
    });

    if (!policy) {
      throw new NotFoundException('Leave policy not found');
    }

    // Delete associated balances first
    await this.prisma.leaveBalance.deleteMany({
      where: { policyId },
    });

    await this.prisma.leavePolicy.delete({
      where: { id: policyId },
    });

    await this.auditService.log({
      companyId,
      userId,
      action: 'LEAVE_POLICY_DELETED',
      targetType: 'LEAVE_POLICY',
      targetId: policyId,
      details: { name: policy.name, type: policy.type },
    });

    return { success: true };
  }

  // ============================================
  // BALANCES
  // ============================================

  async getBalances(companyId: string, filters?: { userId?: string; policyId?: string }) {
    const where: any = { companyId };
    
    if (filters?.userId) {
      where.userId = filters.userId;
    }
    if (filters?.policyId) {
      where.policyId = filters.policyId;
    }

    return this.prisma.leaveBalance.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, phone: true } },
        policy: { select: { id: true, name: true, type: true, annualHours: true } },
      },
      orderBy: [{ user: { name: 'asc' } }],
    });
  }

  async getWorkerBalances(userId: string, companyId: string) {
    return this.prisma.leaveBalance.findMany({
      where: { userId, companyId },
      include: {
        policy: { select: { id: true, name: true, type: true, annualHours: true } },
      },
    });
  }

  async updateBalance(balanceId: string, companyId: string, userId: string, data: {
    totalHours?: number;
    usedHours?: number;
  }) {
    const balance = await this.prisma.leaveBalance.findFirst({
      where: { id: balanceId, companyId },
      include: { user: true, policy: true },
    });

    if (!balance) {
      throw new NotFoundException('Leave balance not found');
    }

    const updated = await this.prisma.leaveBalance.update({
      where: { id: balanceId },
      data: {
        totalHours: data.totalHours,
        usedHours: data.usedHours,
      },
      include: {
        user: { select: { id: true, name: true } },
        policy: { select: { id: true, name: true, type: true } },
      },
    });

    await this.auditService.log({
      companyId,
      userId,
      action: 'LEAVE_BALANCE_UPDATED',
      targetType: 'LEAVE_BALANCE',
      targetId: balanceId,
      details: {
        workerName: balance.user.name,
        policyName: balance.policy.name,
        changes: data,
      },
    });

    return updated;
  }

  // ============================================
  // APPLY TO ALL WORKERS
  // ============================================

  async applyPolicyToAllWorkers(policyId: string, companyId: string, updatedById: string) {
    const policy = await this.prisma.leavePolicy.findFirst({
      where: { id: policyId, companyId },
    });

    if (!policy) {
      throw new NotFoundException('Leave policy not found');
    }

    // Get all active workers in the company
    const workers = await this.prisma.user.findMany({
      where: { companyId, isActive: true, role: 'WORKER' },
      select: { id: true, name: true },
    });

    let created = 0;
    let updated = 0;
    const errors: string[] = [];

    for (const worker of workers) {
      try {
        // Check if balance already exists
        const existing = await this.prisma.leaveBalance.findUnique({
          where: { userId_policyId: { userId: worker.id, policyId } },
        });

        if (existing) {
          // Update existing balance
          await this.prisma.leaveBalance.update({
            where: { id: existing.id },
            data: { totalHours: policy.annualHours },
          });
          updated++;
        } else {
          // Create new balance
          await this.prisma.leaveBalance.create({
            data: {
              companyId,
              userId: worker.id,
              policyId,
              totalHours: policy.annualHours,
              usedHours: 0,
            },
          });
          created++;
        }
      } catch (err) {
        errors.push(`Worker ${worker.name}: ${err.message}`);
      }
    }

    await this.auditService.log({
      companyId,
      userId: updatedById,
      action: 'LEAVE_BALANCE_APPLIED_TO_ALL',
      targetType: 'LEAVE_POLICY',
      targetId: policyId,
      details: {
        policyName: policy.name,
        workersCreated: created,
        workersUpdated: updated,
        errors,
      },
    });

    return {
      success: true,
      created,
      updated,
      total: workers.length,
      errors,
    };
  }

  // ============================================
  // SUMMARY FOR WORKERS PAGE
  // ============================================

  async getWorkersSummary(companyId: string) {
    const workers = await this.prisma.user.findMany({
      where: { companyId, isActive: true, role: 'WORKER' },
      select: {
        id: true,
        name: true,
        phone: true,
        leaveBalances: {
          include: {
            policy: { select: { name: true, type: true } },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    return workers.map(worker => ({
      id: worker.id,
      name: worker.name,
      phone: worker.phone,
      balances: worker.leaveBalances.reduce((acc, bal) => {
        acc[bal.policy.type] = {
          policyName: bal.policy.name,
          total: bal.totalHours,
          used: bal.usedHours,
          available: bal.totalHours - bal.usedHours,
        };
        return acc;
      }, {} as Record<string, any>),
    }));
  }
}
