import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LeaveType } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

@Injectable()
export class LeaveService {
  constructor(private prisma: PrismaService) {}

  // ============================================
  // LEAVE POLICIES (Company Defaults)
  // ============================================

  async getPolicies(companyId: string) {
    return this.prisma.leavePolicy.findMany({
      where: { companyId },
      orderBy: { leaveType: 'asc' },
    });
  }

  async createPolicy(companyId: string, data: {
    leaveType: LeaveType;
    name: string;
    hoursPerYear: number;
    accrualRate?: number;
    maxCarryover?: number;
    maxBalance?: number;
  }) {
    // Check if policy already exists for this leave type
    const existing = await this.prisma.leavePolicy.findUnique({
      where: { companyId_leaveType: { companyId, leaveType: data.leaveType } },
    });

    if (existing) {
      throw new BadRequestException(`Policy for ${data.leaveType} already exists`);
    }

    return this.prisma.leavePolicy.create({
      data: {
        companyId,
        leaveType: data.leaveType,
        name: data.name,
        hoursPerYear: new Decimal(data.hoursPerYear),
        accrualRate: data.accrualRate ? new Decimal(data.accrualRate) : null,
        maxCarryover: data.maxCarryover ? new Decimal(data.maxCarryover) : null,
        maxBalance: data.maxBalance ? new Decimal(data.maxBalance) : null,
      },
    });
  }

  async updatePolicy(companyId: string, policyId: string, data: {
    name?: string;
    hoursPerYear?: number;
    accrualRate?: number;
    maxCarryover?: number;
    maxBalance?: number;
    isActive?: boolean;
  }) {
    const policy = await this.prisma.leavePolicy.findFirst({
      where: { id: policyId, companyId },
    });

    if (!policy) {
      throw new NotFoundException('Leave policy not found');
    }

    return this.prisma.leavePolicy.update({
      where: { id: policyId },
      data: {
        name: data.name,
        hoursPerYear: data.hoursPerYear !== undefined ? new Decimal(data.hoursPerYear) : undefined,
        accrualRate: data.accrualRate !== undefined ? new Decimal(data.accrualRate) : undefined,
        maxCarryover: data.maxCarryover !== undefined ? new Decimal(data.maxCarryover) : undefined,
        maxBalance: data.maxBalance !== undefined ? new Decimal(data.maxBalance) : undefined,
        isActive: data.isActive,
      },
    });
  }

  async deletePolicy(companyId: string, policyId: string) {
    const policy = await this.prisma.leavePolicy.findFirst({
      where: { id: policyId, companyId },
    });

    if (!policy) {
      throw new NotFoundException('Leave policy not found');
    }

    return this.prisma.leavePolicy.delete({
      where: { id: policyId },
    });
  }

  // ============================================
  // LEAVE BALANCES (Per Worker)
  // ============================================

  async getBalances(companyId: string, userId?: string) {
    const where: any = { companyId };
    if (userId) {
      where.userId = userId;
    }

    return this.prisma.leaveBalance.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, phone: true } },
      },
      orderBy: [{ user: { name: 'asc' } }, { leaveType: 'asc' }],
    });
  }

  async getWorkerBalances(companyId: string, userId: string) {
    return this.prisma.leaveBalance.findMany({
      where: { companyId, userId },
      orderBy: { leaveType: 'asc' },
    });
  }

  async updateBalance(companyId: string, balanceId: string, updatedById: string, data: {
    totalHours?: number;
    usedHours?: number;
    notes?: string;
  }) {
    const balance = await this.prisma.leaveBalance.findFirst({
      where: { id: balanceId, companyId },
    });

    if (!balance) {
      throw new NotFoundException('Leave balance not found');
    }

    return this.prisma.leaveBalance.update({
      where: { id: balanceId },
      data: {
        totalHours: data.totalHours !== undefined ? new Decimal(data.totalHours) : undefined,
        usedHours: data.usedHours !== undefined ? new Decimal(data.usedHours) : undefined,
        notes: data.notes,
        lastUpdatedById: updatedById,
      },
    });
  }

  async setWorkerBalance(companyId: string, userId: string, leaveType: LeaveType, updatedById: string, data: {
    totalHours: number;
    usedHours?: number;
    notes?: string;
  }) {
    // Upsert - create or update
    return this.prisma.leaveBalance.upsert({
      where: { userId_leaveType: { userId, leaveType } },
      create: {
        companyId,
        userId,
        leaveType,
        totalHours: new Decimal(data.totalHours),
        usedHours: new Decimal(data.usedHours || 0),
        notes: data.notes,
        lastUpdatedById: updatedById,
      },
      update: {
        totalHours: new Decimal(data.totalHours),
        usedHours: data.usedHours !== undefined ? new Decimal(data.usedHours) : undefined,
        notes: data.notes,
        lastUpdatedById: updatedById,
      },
    });
  }

  // ============================================
  // BULK OPERATIONS
  // ============================================

  async applyPolicyToAllWorkers(companyId: string, policyId: string, updatedById: string) {
    const policy = await this.prisma.leavePolicy.findFirst({
      where: { id: policyId, companyId },
    });

    if (!policy) {
      throw new NotFoundException('Leave policy not found');
    }

    // Get all active workers
    const workers = await this.prisma.user.findMany({
      where: { companyId, isActive: true },
      select: { id: true },
    });

    const results = { created: 0, updated: 0, errors: [] as string[] };

    for (const worker of workers) {
      try {
        await this.prisma.leaveBalance.upsert({
          where: { userId_leaveType: { userId: worker.id, leaveType: policy.leaveType } },
          create: {
            companyId,
            userId: worker.id,
            leaveType: policy.leaveType,
            totalHours: policy.hoursPerYear,
            usedHours: new Decimal(0),
            lastUpdatedById: updatedById,
          },
          update: {
            totalHours: policy.hoursPerYear,
            lastUpdatedById: updatedById,
          },
        });
        results.created++;
      } catch (err) {
        results.errors.push(`Worker ${worker.id}: ${err.message}`);
      }
    }

    return results;
  }

  async applyAllPoliciesToWorker(companyId: string, userId: string, updatedById: string) {
    const policies = await this.prisma.leavePolicy.findMany({
      where: { companyId, isActive: true },
    });

    const results = { created: 0, errors: [] as string[] };

    for (const policy of policies) {
      try {
        await this.prisma.leaveBalance.upsert({
          where: { userId_leaveType: { userId, leaveType: policy.leaveType } },
          create: {
            companyId,
            userId,
            leaveType: policy.leaveType,
            totalHours: policy.hoursPerYear,
            usedHours: new Decimal(0),
            lastUpdatedById: updatedById,
          },
          update: {
            totalHours: policy.hoursPerYear,
            lastUpdatedById: updatedById,
          },
        });
        results.created++;
      } catch (err) {
        results.errors.push(`Policy ${policy.leaveType}: ${err.message}`);
      }
    }

    return results;
  }

  async applyAllPoliciesToAllWorkers(companyId: string, updatedById: string) {
    const policies = await this.prisma.leavePolicy.findMany({
      where: { companyId, isActive: true },
    });

    const workers = await this.prisma.user.findMany({
      where: { companyId, isActive: true },
      select: { id: true },
    });

    let created = 0;
    const errors: string[] = [];

    for (const worker of workers) {
      for (const policy of policies) {
        try {
          await this.prisma.leaveBalance.upsert({
            where: { userId_leaveType: { userId: worker.id, leaveType: policy.leaveType } },
            create: {
              companyId,
              userId: worker.id,
              leaveType: policy.leaveType,
              totalHours: policy.hoursPerYear,
              usedHours: new Decimal(0),
              lastUpdatedById: updatedById,
            },
            update: {
              totalHours: policy.hoursPerYear,
              lastUpdatedById: updatedById,
            },
          });
          created++;
        } catch (err) {
          errors.push(`Worker ${worker.id} / ${policy.leaveType}: ${err.message}`);
        }
      }
    }

    return { created, workers: workers.length, policies: policies.length, errors };
  }

  // ============================================
  // SUMMARY FOR DISPLAY
  // ============================================

  async getWorkersSummary(companyId: string) {
    // Get all workers with their balances
    const workers = await this.prisma.user.findMany({
      where: { companyId, isActive: true },
      select: {
        id: true,
        name: true,
        phone: true,
        leaveBalances: {
          select: {
            leaveType: true,
            totalHours: true,
            usedHours: true,
            pendingHours: true,
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
        acc[bal.leaveType] = {
          total: Number(bal.totalHours),
          used: Number(bal.usedHours),
          pending: Number(bal.pendingHours),
          available: Number(bal.totalHours) - Number(bal.usedHours) - Number(bal.pendingHours),
        };
        return acc;
      }, {} as Record<string, { total: number; used: number; pending: number; available: number }>),
    }));
  }
}
