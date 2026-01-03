import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { Decimal } from '@prisma/client/runtime/library';

interface BreakComplianceSettings {
  enabled: boolean;
  state: string;
  mealBreakThreshold: number;
  mealBreakDuration: number;
  secondMealThreshold: number;
  restBreakInterval: number;
  restBreakDuration: number;
  penaltyRate: number;
}

interface BreakViolationData {
  type: 'MISSED_MEAL_BREAK' | 'SHORT_MEAL_BREAK' | 'LATE_MEAL_BREAK' | 'MISSED_REST_BREAK' | 'MISSED_SECOND_MEAL';
  description: string;
  requiredMinutes: number;
  actualMinutes: number;
  penaltyHours: number;
}

interface ComplianceCheckResult {
  isCompliant: boolean;
  violations: BreakViolationData[];
  totalPenaltyHours: number;
  totalPenaltyAmount: number;
}

@Injectable()
export class BreakComplianceService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
  ) {}

  async getComplianceSettings(companyId: string): Promise<BreakComplianceSettings> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { breakComplianceSettings: true },
    });

    const defaults: BreakComplianceSettings = {
      enabled: true,
      state: 'CA',
      mealBreakThreshold: 300,
      mealBreakDuration: 30,
      secondMealThreshold: 600,
      restBreakInterval: 240,
      restBreakDuration: 10,
      penaltyRate: 1.0,
    };

    if (!company?.breakComplianceSettings) return defaults;

    const settings = company.breakComplianceSettings as any;
    return { ...defaults, ...settings };
  }

  checkCompliance(
    durationMinutes: number,
    mealBreakMinutes: number,
    restBreakCount: number,
    settings: BreakComplianceSettings,
  ): ComplianceCheckResult {
    const violations: BreakViolationData[] = [];

    if (!settings.enabled) {
      return { isCompliant: true, violations: [], totalPenaltyHours: 0, totalPenaltyAmount: 0 };
    }

    // Check first meal break (5+ hours worked in CA)
    if (durationMinutes >= settings.mealBreakThreshold) {
      if (mealBreakMinutes < settings.mealBreakDuration) {
        if (mealBreakMinutes === 0) {
          violations.push({
            type: 'MISSED_MEAL_BREAK',
            description: `Worked ${(durationMinutes / 60).toFixed(1)} hours without a meal break. ${settings.state === 'CA' ? 'California' : 'State'} law requires a ${settings.mealBreakDuration}-minute meal break when working more than ${settings.mealBreakThreshold / 60} hours.`,
            requiredMinutes: settings.mealBreakDuration,
            actualMinutes: 0,
            penaltyHours: settings.penaltyRate,
          });
        } else {
          violations.push({
            type: 'SHORT_MEAL_BREAK',
            description: `Meal break was ${mealBreakMinutes} minutes, but ${settings.mealBreakDuration} minutes is required.`,
            requiredMinutes: settings.mealBreakDuration,
            actualMinutes: mealBreakMinutes,
            penaltyHours: settings.penaltyRate,
          });
        }
      }
    }

    // Check second meal break (10+ hours worked in CA)
    if (durationMinutes >= settings.secondMealThreshold) {
      // For second meal, we'd need to track multiple breaks
      // For now, check if total break time covers two meal breaks
      const requiredTotalMealTime = settings.mealBreakDuration * 2;
      if (mealBreakMinutes < requiredTotalMealTime) {
        violations.push({
          type: 'MISSED_SECOND_MEAL',
          description: `Worked ${(durationMinutes / 60).toFixed(1)} hours. A second ${settings.mealBreakDuration}-minute meal break is required after ${settings.secondMealThreshold / 60} hours.`,
          requiredMinutes: settings.mealBreakDuration,
          actualMinutes: Math.max(0, mealBreakMinutes - settings.mealBreakDuration),
          penaltyHours: settings.penaltyRate,
        });
      }
    }

    // Check rest breaks (every 4 hours in CA = 10 min break)
    const requiredRestBreaks = Math.floor(durationMinutes / settings.restBreakInterval);
    if (requiredRestBreaks > restBreakCount) {
      const missedRestBreaks = requiredRestBreaks - restBreakCount;
      violations.push({
        type: 'MISSED_REST_BREAK',
        description: `Missed ${missedRestBreaks} rest break(s). ${settings.state === 'CA' ? 'California' : 'State'} law requires a ${settings.restBreakDuration}-minute rest break for every ${settings.restBreakInterval / 60} hours worked.`,
        requiredMinutes: settings.restBreakDuration * missedRestBreaks,
        actualMinutes: restBreakCount * settings.restBreakDuration,
        penaltyHours: settings.penaltyRate * missedRestBreaks,
      });
    }

    const totalPenaltyHours = violations.reduce((sum, v) => sum + v.penaltyHours, 0);

    return {
      isCompliant: violations.length === 0,
      violations,
      totalPenaltyHours,
      totalPenaltyAmount: 0, // Will be calculated with hourly rate
    };
  }

  async recordViolations(
    companyId: string,
    userId: string,
    timeEntryId: string,
    violations: BreakViolationData[],
    hourlyRate: number | null,
  ) {
    const createdViolations = [];

    for (const violation of violations) {
      const penaltyAmount = hourlyRate ? violation.penaltyHours * hourlyRate : null;

      const record = await this.prisma.breakViolation.create({
        data: {
          companyId,
          userId,
          timeEntryId,
          violationType: violation.type,
          description: violation.description,
          requiredMinutes: violation.requiredMinutes,
          actualMinutes: violation.actualMinutes,
          penaltyHours: new Decimal(violation.penaltyHours),
          penaltyAmount: penaltyAmount ? new Decimal(penaltyAmount) : null,
        },
      });

      createdViolations.push(record);
    }

    // Update time entry with compliance status
    const totalPenalty = violations.reduce((sum, v) => {
      return sum + (hourlyRate ? v.penaltyHours * hourlyRate : 0);
    }, 0);

    await this.prisma.timeEntry.update({
      where: { id: timeEntryId },
      data: {
        breakCompliant: false,
        breakPenaltyPay: totalPenalty > 0 ? new Decimal(totalPenalty) : null,
      },
    });

    return createdViolations;
  }

  async getViolations(companyId: string, filters?: {
    userId?: string;
    startDate?: Date;
    endDate?: Date;
    waived?: boolean;
  }) {
    const where: any = { companyId };

    if (filters?.userId) where.userId = filters.userId;
    if (filters?.waived !== undefined) where.waived = filters.waived;
    if (filters?.startDate || filters?.endDate) {
      where.createdAt = {};
      if (filters.startDate) where.createdAt.gte = filters.startDate;
      if (filters.endDate) where.createdAt.lte = filters.endDate;
    }

    return this.prisma.breakViolation.findMany({
      where,
      include: {
        user: { select: { id: true, name: true } },
        timeEntry: { select: { id: true, clockInTime: true, clockOutTime: true, durationMinutes: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getComplianceStats(companyId: string, startDate?: Date, endDate?: Date) {
    const where: any = { companyId };
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = startDate;
      if (endDate) where.createdAt.lte = endDate;
    }

    const [totalViolations, waivedViolations, violations] = await Promise.all([
      this.prisma.breakViolation.count({ where }),
      this.prisma.breakViolation.count({ where: { ...where, waived: true } }),
      this.prisma.breakViolation.findMany({
        where,
        select: { violationType: true, penaltyAmount: true, waived: true },
      }),
    ]);

    // Calculate penalty totals
    const totalPenalty = violations
      .filter(v => !v.waived)
      .reduce((sum, v) => sum + (v.penaltyAmount ? Number(v.penaltyAmount) : 0), 0);

    // Count by type
    const byType = violations.reduce((acc, v) => {
      acc[v.violationType] = (acc[v.violationType] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    // Get affected workers count
    const affectedWorkers = await this.prisma.breakViolation.groupBy({
      by: ['userId'],
      where,
    });

    return {
      totalViolations,
      activeViolations: totalViolations - waivedViolations,
      waivedViolations,
      totalPenalty: Math.round(totalPenalty * 100) / 100,
      affectedWorkers: affectedWorkers.length,
      byType,
    };
  }

  async waiveViolation(violationId: string, waivedBy: string, companyId: string, reason: string) {
    const violation = await this.prisma.breakViolation.findFirst({
      where: { id: violationId, companyId },
      include: { user: { select: { name: true } } },
    });

    if (!violation) {
      throw new Error('Violation not found');
    }

    const updated = await this.prisma.breakViolation.update({
      where: { id: violationId },
      data: {
        waived: true,
        waivedBy,
        waivedAt: new Date(),
        waivedReason: reason,
      },
    });

    await this.auditService.log({
      companyId,
      userId: waivedBy,
      action: 'BREAK_VIOLATION_WAIVED',
      targetType: 'BREAK_VIOLATION',
      targetId: violationId,
      details: {
        workerName: violation.user?.name,
        violationType: violation.violationType,
        reason,
      },
    });

    return updated;
  }

  async updateCompanySettings(companyId: string, settings: Partial<BreakComplianceSettings>, updatedBy: string) {
    const current = await this.getComplianceSettings(companyId);
    const newSettings = { ...current, ...settings };

    await this.prisma.company.update({
      where: { id: companyId },
      data: { breakComplianceSettings: newSettings as any },
    });

    await this.auditService.log({
      companyId,
      userId: updatedBy,
      action: 'COMPANY_SETTINGS_UPDATED',
      targetType: 'COMPANY',
      targetId: companyId,
      details: { settingType: 'breakCompliance', changes: settings },
    });

    return newSettings;
  }
}
