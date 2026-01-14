import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PayPeriodsService {
  constructor(private prisma: PrismaService) {}

  // ============================================
  // GET PAY PERIODS
  // ============================================

  async getPayPeriods(companyId: string, options?: { status?: string; limit?: number }) {
    const where: any = { companyId };
    
    if (options?.status) {
      where.status = options.status;
    }

    const payPeriods = await this.prisma.payPeriod.findMany({
      where,
      orderBy: { startDate: 'desc' },
      take: options?.limit || 52, // Last year by default
    });

    // Get time entry counts for each period
    const periodsWithCounts = await Promise.all(
      payPeriods.map(async (period) => {
        const entries = await this.prisma.timeEntry.aggregate({
          where: {
            companyId,
            clockInTime: {
              gte: period.startDate,
              lte: new Date(new Date(period.endDate).setHours(23, 59, 59, 999)),
            },
          },
          _count: true,
          _sum: {
            durationMinutes: true,
            regularMinutes: true,
            overtimeMinutes: true,
            doubleTimeMinutes: true,
          },
        });

        const pendingCount = await this.prisma.timeEntry.count({
          where: {
            companyId,
            clockInTime: {
              gte: period.startDate,
              lte: new Date(new Date(period.endDate).setHours(23, 59, 59, 999)),
            },
            approvalStatus: 'PENDING',
          },
        });

        return {
          ...period,
          entryCount: entries._count,
          pendingCount,
          totalMinutes: entries._sum.durationMinutes || 0,
          regularMinutes: entries._sum.regularMinutes || 0,
          overtimeMinutes: entries._sum.overtimeMinutes || 0,
          doubleTimeMinutes: entries._sum.doubleTimeMinutes || 0,
        };
      })
    );

    return periodsWithCounts;
  }

  // ============================================
  // GET CURRENT PAY PERIOD
  // ============================================

  async getCurrentPayPeriod(companyId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let payPeriod = await this.prisma.payPeriod.findFirst({
      where: {
        companyId,
        startDate: { lte: today },
        endDate: { gte: today },
      },
    });

    // If no current period, create one (weekly, Mon-Sun)
    if (!payPeriod) {
      const dayOfWeek = today.getDay();
      const monday = new Date(today);
      monday.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
      
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);

      payPeriod = await this.prisma.payPeriod.create({
        data: {
          companyId,
          startDate: monday,
          endDate: sunday,
          status: 'OPEN',
        },
      });

      await this.prisma.auditLog.create({
        data: {
          companyId,
          action: 'PAY_PERIOD_CREATED',
          targetType: 'PayPeriod',
          targetId: payPeriod.id,
          details: { startDate: monday, endDate: sunday, autoCreated: true },
        },
      });
    }

    return payPeriod;
  }

  // ============================================
  // CREATE PAY PERIOD
  // ============================================

  async createPayPeriod(companyId: string, createdById: string, data: { startDate: Date; endDate: Date }) {
    const { startDate, endDate } = data;

    if (new Date(startDate) >= new Date(endDate)) {
      throw new BadRequestException('Start date must be before end date');
    }

    // Check for overlapping periods
    const overlapping = await this.prisma.payPeriod.findFirst({
      where: {
        companyId,
        OR: [
          {
            startDate: { lte: new Date(endDate) },
            endDate: { gte: new Date(startDate) },
          },
        ],
      },
    });

    if (overlapping) {
      throw new BadRequestException('Pay period overlaps with existing period');
    }

    const payPeriod = await this.prisma.payPeriod.create({
      data: {
        companyId,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        status: 'OPEN',
      },
    });

    await this.prisma.auditLog.create({
      data: {
        companyId,
        userId: createdById,
        action: 'PAY_PERIOD_CREATED',
        targetType: 'PayPeriod',
        targetId: payPeriod.id,
        details: { startDate, endDate },
      },
    });

    return payPeriod;
  }

  // ============================================
  // LOCK PAY PERIOD
  // ============================================

  async lockPayPeriod(companyId: string, lockedById: string, payPeriodId: string, userRole: string) {
    const payPeriod = await this.prisma.payPeriod.findFirst({
      where: { id: payPeriodId, companyId },
    });

    if (!payPeriod) {
      throw new NotFoundException('Pay period not found');
    }

    if (payPeriod.status === 'LOCKED') {
      throw new BadRequestException('Pay period is already locked');
    }

    // Check for pending time entries
    const pendingCount = await this.prisma.timeEntry.count({
      where: {
        companyId,
        clockInTime: {
          gte: payPeriod.startDate,
          lte: new Date(new Date(payPeriod.endDate).setHours(23, 59, 59, 999)),
        },
        approvalStatus: 'PENDING',
      },
    });

    if (pendingCount > 0) {
      throw new BadRequestException(`Cannot lock: ${pendingCount} time entries are still pending approval`);
    }

    // Update pay period
    const updated = await this.prisma.payPeriod.update({
      where: { id: payPeriodId },
      data: {
        status: 'LOCKED',
        lockedAt: new Date(),
        lockedById,
      },
    });

    // Lock all time entries in this period
    await this.prisma.timeEntry.updateMany({
      where: {
        companyId,
        clockInTime: {
          gte: payPeriod.startDate,
          lte: new Date(new Date(payPeriod.endDate).setHours(23, 59, 59, 999)),
        },
      },
      data: {
        isLocked: true,
        lockedAt: new Date(),
      },
    });

    await this.prisma.auditLog.create({
      data: {
        companyId,
        userId: lockedById,
        action: 'PAY_PERIOD_LOCKED',
        targetType: 'PayPeriod',
        targetId: payPeriodId,
        details: { startDate: payPeriod.startDate, endDate: payPeriod.endDate },
      },
    });

    console.log(`🔒 Pay period locked: ${payPeriod.startDate.toDateString()} - ${payPeriod.endDate.toDateString()}`);

    return updated;
  }

  // ============================================
  // UNLOCK PAY PERIOD (Owner only)
  // ============================================

  async unlockPayPeriod(
    companyId: string,
    unlockedById: string,
    payPeriodId: string,
    userRole: string,
    reason: string,
  ) {
    if (userRole !== 'OWNER') {
      throw new ForbiddenException('Only owners can unlock pay periods');
    }

    if (!reason || reason.trim().length < 10) {
      throw new BadRequestException('Please provide a reason for unlocking (minimum 10 characters)');
    }

    const payPeriod = await this.prisma.payPeriod.findFirst({
      where: { id: payPeriodId, companyId },
    });

    if (!payPeriod) {
      throw new NotFoundException('Pay period not found');
    }

    if (payPeriod.status !== 'LOCKED') {
      throw new BadRequestException('Pay period is not locked');
    }

    // Update pay period
    const updated = await this.prisma.payPeriod.update({
      where: { id: payPeriodId },
      data: {
        status: 'OPEN',
        overrideAt: new Date(),
        overrideById: unlockedById,
        overrideReason: reason,
      },
    });

    // Unlock all time entries in this period
    await this.prisma.timeEntry.updateMany({
      where: {
        companyId,
        clockInTime: {
          gte: payPeriod.startDate,
          lte: new Date(new Date(payPeriod.endDate).setHours(23, 59, 59, 999)),
        },
      },
      data: {
        isLocked: false,
        lockedAt: null,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        companyId,
        userId: unlockedById,
        action: 'PAY_PERIOD_UNLOCKED',
        targetType: 'PayPeriod',
        targetId: payPeriodId,
        details: { 
          startDate: payPeriod.startDate, 
          endDate: payPeriod.endDate,
          reason,
        },
      },
    });

    console.log(`🔓 Pay period unlocked: ${payPeriod.startDate.toDateString()} - ${payPeriod.endDate.toDateString()} - Reason: ${reason}`);

    return updated;
  }

  // ============================================
  // MARK AS EXPORTED
  // ============================================

  async markAsExported(companyId: string, exportedById: string, payPeriodId: string) {
    const payPeriod = await this.prisma.payPeriod.findFirst({
      where: { id: payPeriodId, companyId },
    });

    if (!payPeriod) {
      throw new NotFoundException('Pay period not found');
    }

    const updated = await this.prisma.payPeriod.update({
      where: { id: payPeriodId },
      data: {
        status: 'EXPORTED',
        exportedAt: new Date(),
        exportedById,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        companyId,
        userId: exportedById,
        action: 'PAY_PERIOD_EXPORTED',
        targetType: 'PayPeriod',
        targetId: payPeriodId,
        details: { startDate: payPeriod.startDate, endDate: payPeriod.endDate },
      },
    });

    return updated;
  }

  // ============================================
  // GET PAY PERIOD DETAILS
  // ============================================

  async getPayPeriodDetails(companyId: string, payPeriodId: string) {
    const payPeriod = await this.prisma.payPeriod.findFirst({
      where: { id: payPeriodId, companyId },
    });

    if (!payPeriod) {
      throw new NotFoundException('Pay period not found');
    }

    // Get time entries for this period
    const entries = await this.prisma.timeEntry.findMany({
      where: {
        companyId,
        clockInTime: {
          gte: payPeriod.startDate,
          lte: new Date(new Date(payPeriod.endDate).setHours(23, 59, 59, 999)),
        },
      },
      include: {
        user: { select: { id: true, name: true } },
        job: { select: { id: true, name: true } },
      },
      orderBy: { clockInTime: 'asc' },
    });

    // Group by user
    const byUser: Record<string, any> = {};
    entries.forEach(entry => {
      const userId = entry.user.id;
      if (!byUser[userId]) {
        byUser[userId] = {
          user: entry.user,
          entries: [],
          totalMinutes: 0,
          regularMinutes: 0,
          overtimeMinutes: 0,
          doubleTimeMinutes: 0,
          pendingCount: 0,
          approvedCount: 0,
        };
      }
      byUser[userId].entries.push(entry);
      byUser[userId].totalMinutes += entry.durationMinutes || 0;
      byUser[userId].regularMinutes += entry.regularMinutes || 0;
      byUser[userId].overtimeMinutes += entry.overtimeMinutes || 0;
      byUser[userId].doubleTimeMinutes += entry.doubleTimeMinutes || 0;
      if (entry.approvalStatus === 'PENDING') byUser[userId].pendingCount++;
      if (entry.approvalStatus === 'APPROVED') byUser[userId].approvedCount++;
    });

    return {
      ...payPeriod,
      entries,
      byUser: Object.values(byUser),
      summary: {
        totalEntries: entries.length,
        pendingCount: entries.filter(e => e.approvalStatus === 'PENDING').length,
        approvedCount: entries.filter(e => e.approvalStatus === 'APPROVED').length,
        totalMinutes: entries.reduce((sum, e) => sum + (e.durationMinutes || 0), 0),
        regularMinutes: entries.reduce((sum, e) => sum + (e.regularMinutes || 0), 0),
        overtimeMinutes: entries.reduce((sum, e) => sum + (e.overtimeMinutes || 0), 0),
        doubleTimeMinutes: entries.reduce((sum, e) => sum + (e.doubleTimeMinutes || 0), 0),
      },
    };
  }
}
