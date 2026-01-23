import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type PayPeriodType = 'WEEKLY' | 'BIWEEKLY' | 'SEMIMONTHLY' | 'MONTHLY' | 'CUSTOM';

@Injectable()
export class PayPeriodsService {
  constructor(private prisma: PrismaService) {}

  // ============================================
  // GET PAY PERIOD SETTINGS
  // ============================================

  async getSettings(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: {
        payPeriodType: true,
        payPeriodStartDay: true,
        payPeriodAnchorDate: true,
        customPayPeriodDays: true,
      },
    });

    return {
      payPeriodType: company?.payPeriodType || null,
      payPeriodStartDay: company?.payPeriodStartDay ?? 1,
      payPeriodAnchorDate: company?.payPeriodAnchorDate || null,
      customPayPeriodDays: company?.customPayPeriodDays || null,
      isConfigured: !!company?.payPeriodType,
    };
  }

  // ============================================
  // CONFIGURE PAY PERIOD SETTINGS
  // ============================================

  async configureSettings(
    companyId: string,
    configuredById: string,
    data: {
      payPeriodType: PayPeriodType;
      payPeriodStartDay?: number;
      payPeriodAnchorDate?: string;
      customPayPeriodDays?: number;
    },
  ) {
    const { payPeriodType, payPeriodStartDay, payPeriodAnchorDate, customPayPeriodDays } = data;

    // Validate based on type
    if (payPeriodType === 'WEEKLY' || payPeriodType === 'BIWEEKLY') {
      if (payPeriodStartDay === undefined || payPeriodStartDay < 0 || payPeriodStartDay > 6) {
        throw new BadRequestException('Weekly/Biweekly periods require payPeriodStartDay (0-6, 0=Sunday)');
      }
    }

    if (payPeriodType === 'BIWEEKLY' && !payPeriodAnchorDate) {
      throw new BadRequestException('Biweekly periods require an anchor date');
    }

    if (payPeriodType === 'SEMIMONTHLY') {
      if (payPeriodStartDay === undefined || payPeriodStartDay < 1 || payPeriodStartDay > 15) {
        throw new BadRequestException('Semi-monthly periods require payPeriodStartDay (1-15, first period starts this day)');
      }
    }

    if (payPeriodType === 'MONTHLY') {
      if (payPeriodStartDay === undefined || payPeriodStartDay < 1 || payPeriodStartDay > 28) {
        throw new BadRequestException('Monthly periods require payPeriodStartDay (1-28)');
      }
    }

    if (payPeriodType === 'CUSTOM') {
      if (!customPayPeriodDays || customPayPeriodDays < 1 || customPayPeriodDays > 31) {
        throw new BadRequestException('Custom periods require customPayPeriodDays (1-31)');
      }
      if (!payPeriodAnchorDate) {
        throw new BadRequestException('Custom periods require an anchor date');
      }
    }

    // Update company settings
    await this.prisma.company.update({
      where: { id: companyId },
      data: {
        payPeriodType,
        payPeriodStartDay: payPeriodStartDay ?? 1,
        payPeriodAnchorDate: payPeriodAnchorDate ? new Date(payPeriodAnchorDate) : null,
        customPayPeriodDays: customPayPeriodDays || null,
      },
    });

    // Audit log
    await this.prisma.auditLog.create({
      data: {
        companyId,
        userId: configuredById,
        action: 'COMPANY_SETTINGS_UPDATED',
        targetType: 'Company',
        targetId: companyId,
        details: { payPeriodType, payPeriodStartDay, payPeriodAnchorDate, customPayPeriodDays },
      },
    });

    // Generate current and next pay period
    await this.ensureCurrentPayPeriod(companyId);

    console.log(`📅 Pay period configured: ${payPeriodType} for company ${companyId}`);

    return { success: true, payPeriodType };
  }

  // ============================================
  // CALCULATE PAY PERIOD DATES
  // ============================================

  // ============================================
  // CALCULATE PAY PERIOD DATES (FIXED - UTC)
  // ============================================

  calculatePayPeriodDates(
    type: PayPeriodType,
    startDay: number,
    anchorDate: Date | null,
    customDays: number | null,
    forDate: Date = new Date(),
  ): { startDate: Date; endDate: Date } {
    // Use UTC for all calculations to avoid timezone issues
    const date = new Date(forDate);
    date.setUTCHours(12, 0, 0, 0); // Set to noon UTC to avoid boundary issues

    switch (type) {
      case 'WEEKLY': {
        // Find the most recent startDay (0=Sunday, 6=Saturday)
        const dayOfWeek = date.getUTCDay();
        const diff = (dayOfWeek - startDay + 7) % 7;
        const startDate = new Date(date);
        startDate.setUTCDate(date.getUTCDate() - diff);
        startDate.setUTCHours(0, 0, 0, 0);
        const endDate = new Date(startDate);
        endDate.setUTCDate(startDate.getUTCDate() + 6);
        endDate.setUTCHours(23, 59, 59, 999);
        return { startDate, endDate };
      }

      case 'BIWEEKLY': {
        if (!anchorDate) throw new BadRequestException('Biweekly requires anchor date');
        const anchor = new Date(anchorDate);
        anchor.setUTCHours(12, 0, 0, 0); // Noon UTC
        
        // Calculate days since anchor
        const msPerDay = 24 * 60 * 60 * 1000;
        const daysSinceAnchor = Math.floor((date.getTime() - anchor.getTime()) / msPerDay);
        const biweekPeriod = Math.floor(daysSinceAnchor / 14);
        
        const startDate = new Date(anchor);
        startDate.setUTCDate(anchor.getUTCDate() + (biweekPeriod * 14));
        startDate.setUTCHours(0, 0, 0, 0);
        
        const endDate = new Date(startDate);
        endDate.setUTCDate(startDate.getUTCDate() + 13);
        endDate.setUTCHours(23, 59, 59, 999);
        
        return { startDate, endDate };
      }

      case 'SEMIMONTHLY': {
        const year = date.getUTCFullYear();
        const month = date.getUTCMonth();
        const dayOfMonth = date.getUTCDate();

        let startDate: Date;
        let endDate: Date;

        if (dayOfMonth < 16) {
          // First half: startDay to 15th
          startDate = new Date(Date.UTC(year, month, startDay, 0, 0, 0, 0));
          endDate = new Date(Date.UTC(year, month, 15, 23, 59, 59, 999));
        } else {
          // Second half: 16th to startDay-1 of next month
          startDate = new Date(Date.UTC(year, month, 16, 0, 0, 0, 0));
          if (startDay === 1) {
            // End on last day of current month
            endDate = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));
          } else {
            endDate = new Date(Date.UTC(year, month + 1, startDay - 1, 23, 59, 59, 999));
          }
        }
        return { startDate, endDate };
      }

      case 'MONTHLY': {
        const year = date.getUTCFullYear();
        const month = date.getUTCMonth();
        const dayOfMonth = date.getUTCDate();

        let startDate: Date;
        let endDate: Date;

        if (dayOfMonth >= startDay) {
          startDate = new Date(Date.UTC(year, month, startDay, 0, 0, 0, 0));
          // End on startDay-1 of next month
          if (startDay === 1) {
            endDate = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999)); // Last day of current month
          } else {
            endDate = new Date(Date.UTC(year, month + 1, startDay - 1, 23, 59, 59, 999));
          }
        } else {
          startDate = new Date(Date.UTC(year, month - 1, startDay, 0, 0, 0, 0));
          if (startDay === 1) {
            endDate = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999)); // Last day of previous month
          } else {
            endDate = new Date(Date.UTC(year, month, startDay - 1, 23, 59, 59, 999));
          }
        }
        
        return { startDate, endDate };
      }

      case 'CUSTOM': {
        if (!anchorDate || !customDays) throw new BadRequestException('Custom requires anchor and days');
        const anchor = new Date(anchorDate);
        anchor.setUTCHours(12, 0, 0, 0);
        
        const msPerDay = 24 * 60 * 60 * 1000;
        const daysSinceAnchor = Math.floor((date.getTime() - anchor.getTime()) / msPerDay);
        const periodNumber = Math.floor(daysSinceAnchor / customDays);
        
        const startDate = new Date(anchor);
        startDate.setUTCDate(anchor.getUTCDate() + (periodNumber * customDays));
        startDate.setUTCHours(0, 0, 0, 0);
        
        const endDate = new Date(startDate);
        endDate.setUTCDate(startDate.getUTCDate() + customDays - 1);
        endDate.setUTCHours(23, 59, 59, 999);
        
        return { startDate, endDate };
      }

      default:
        throw new BadRequestException(`Unknown pay period type: ${type}`);
    }
  }

  // ============================================
  // ENSURE CURRENT PAY PERIOD EXISTS
  // ============================================

  async ensureCurrentPayPeriod(companyId: string): Promise<any> {
    const settings = await this.getSettings(companyId);
    
    if (!settings.isConfigured) {
      return null;
    }

    const { startDate, endDate } = this.calculatePayPeriodDates(
      settings.payPeriodType as PayPeriodType,
      settings.payPeriodStartDay,
      settings.payPeriodAnchorDate,
      settings.customPayPeriodDays,
    );

    // Check if period exists
    let payPeriod = await this.prisma.payPeriod.findFirst({
      where: {
        companyId,
        startDate,
        endDate,
      },
    });

    if (!payPeriod) {
      payPeriod = await this.prisma.payPeriod.create({
        data: {
          companyId,
          startDate,
          endDate,
          status: 'OPEN',
          isAutoGenerated: true,
        },
      });

      console.log(`📅 Auto-created pay period: ${startDate.toDateString()} - ${endDate.toDateString()}`);
    }

    return payPeriod;
  }

  // ============================================
  // GET CURRENT PAY PERIOD
  // ============================================

  async getCurrentPayPeriod(companyId: string) {
    return this.ensureCurrentPayPeriod(companyId);
  }

  // ============================================
  // GET PAY PERIODS
  // ============================================

  async getPayPeriods(companyId: string, options?: { status?: string; limit?: number }) {
    // Ensure current period exists
    await this.ensureCurrentPayPeriod(companyId);

    const where: any = { companyId };
    
    if (options?.status) {
      where.status = options.status;
    }

    const payPeriods = await this.prisma.payPeriod.findMany({
      where,
      orderBy: { startDate: 'desc' },
      take: options?.limit || 52,
    });

    // Get counts for each period
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
  // CREATE PAY PERIOD (Manual)
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
        isAutoGenerated: false,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        companyId,
        userId: createdById,
        action: 'PAY_PERIOD_CREATED',
        targetType: 'PayPeriod',
        targetId: payPeriod.id,
        details: { startDate, endDate, manual: true },
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

    // Lock all time entries and assign payPeriodId
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
        payPeriodId: payPeriodId,
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
      where: { payPeriodId },
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

    console.log(`🔓 Pay period unlocked: ${payPeriod.startDate.toDateString()} - Reason: ${reason}`);

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
        user: { select: { id: true, name: true, hourlyRate: true } },
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
          totalPay: 0,
        };
      }
      byUser[userId].entries.push(entry);
      byUser[userId].totalMinutes += entry.durationMinutes || 0;
      byUser[userId].regularMinutes += entry.regularMinutes || 0;
      byUser[userId].overtimeMinutes += entry.overtimeMinutes || 0;
      byUser[userId].doubleTimeMinutes += entry.doubleTimeMinutes || 0;
      byUser[userId].totalPay += Number(entry.laborCost || 0);
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
        totalPay: entries.reduce((sum, e) => sum + Number(e.laborCost || 0), 0),
      },
    };
  }

  // ============================================
  // EXPORT PAY PERIOD
  // ============================================

  async exportPayPeriod(companyId: string, payPeriodId: string, format: string = 'CSV') {
    const details = await this.getPayPeriodDetails(companyId, payPeriodId);
    
    // Return data ready for export
    return {
      payPeriod: {
        startDate: details.startDate,
        endDate: details.endDate,
        status: details.status,
      },
      summary: details.summary,
      employees: details.byUser.map((u: any) => ({
        name: u.user.name,
        regularHours: (u.regularMinutes / 60).toFixed(2),
        overtimeHours: (u.overtimeMinutes / 60).toFixed(2),
        doubleTimeHours: (u.doubleTimeMinutes / 60).toFixed(2),
        totalHours: (u.totalMinutes / 60).toFixed(2),
        totalPay: u.totalPay.toFixed(2),
        entriesCount: u.entries.length,
      })),
      entries: details.entries.map((e: any) => ({
        employeeName: e.user.name,
        date: new Date(e.clockInTime).toLocaleDateString(),
        clockIn: new Date(e.clockInTime).toLocaleTimeString(),
        clockOut: e.clockOutTime ? new Date(e.clockOutTime).toLocaleTimeString() : '',
        jobSite: e.job?.name || '',
        regularHours: (e.regularMinutes / 60).toFixed(2),
        overtimeHours: (e.overtimeMinutes / 60).toFixed(2),
        doubleTimeHours: (e.doubleTimeMinutes / 60).toFixed(2),
        totalHours: ((e.durationMinutes || 0) / 60).toFixed(2),
        hourlyRate: e.hourlyRate?.toString() || '',
        totalPay: e.laborCost?.toString() || '',
        status: e.approvalStatus,
      })),
    };
  }

  // ============================================
  // GET PAY PERIOD FOR DATE
  // ============================================

  async getPayPeriodForDate(companyId: string, date: Date) {
    const settings = await this.getSettings(companyId);
    
    if (!settings.isConfigured) {
      return null;
    }

    const { startDate, endDate } = this.calculatePayPeriodDates(
      settings.payPeriodType as PayPeriodType,
      settings.payPeriodStartDay,
      settings.payPeriodAnchorDate,
      settings.customPayPeriodDays,
      date,
    );

    // Find or create the period
    let payPeriod = await this.prisma.payPeriod.findFirst({
      where: {
        companyId,
        startDate,
        endDate,
      },
    });

    if (!payPeriod) {
      payPeriod = await this.prisma.payPeriod.create({
        data: {
          companyId,
          startDate,
          endDate,
          status: 'OPEN',
          isAutoGenerated: true,
        },
      });
    }

    return payPeriod;
  }
}
