import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleAutoClockOut() {
    this.logger.log('Running auto clock-out check...');

    try {
      // Get all companies with their settings
      const companies = await this.prisma.company.findMany({
        where: { isActive: true },
        select: { id: true, settings: true },
      });

      for (const company of companies) {
        const settings = (company.settings as any) || {};
        const maxShiftHours = settings.maxShiftHours || 16; // Default 16 hours
        const maxShiftMinutes = maxShiftHours * 60;

        // Find open time entries that exceed max shift time
        const cutoffTime = new Date();
        cutoffTime.setHours(cutoffTime.getHours() - maxShiftHours);

        const overdueEntries = await this.prisma.timeEntry.findMany({
          where: {
            companyId: company.id,
            clockOutTime: null,
            clockInTime: { lt: cutoffTime },
          },
          include: {
            user: { select: { id: true, name: true } },
            job: { select: { id: true, name: true } },
          },
        });

        for (const entry of overdueEntries) {
          // Calculate clock out time (max hours after clock in)
          const autoClockOutTime = new Date(entry.clockInTime);
          autoClockOutTime.setMinutes(autoClockOutTime.getMinutes() + maxShiftMinutes);

          // Auto clock out
          await this.prisma.timeEntry.update({
            where: { id: entry.id },
            data: {
              clockOutTime: autoClockOutTime,
              durationMinutes: maxShiftMinutes,
              isFlagged: true,
              flagReason: `Auto clock-out: Exceeded ${maxShiftHours} hour maximum shift time`,
              notes: entry.notes 
                ? `${entry.notes} | AUTO CLOCK-OUT: Worker did not clock out, auto-clocked after ${maxShiftHours} hours`
                : `AUTO CLOCK-OUT: Worker did not clock out, auto-clocked after ${maxShiftHours} hours`,
            },
          });

          // Log audit
          await this.auditService.log({
            companyId: company.id,
            userId: null,
            action: 'TIME_ENTRY_EDITED',
            targetType: 'TIME_ENTRY',
            targetId: entry.id,
            details: {
              reason: 'Auto clock-out - exceeded max shift time',
              workerName: entry.user.name,
              jobName: entry.job?.name,
              maxShiftHours,
              clockInTime: entry.clockInTime,
              autoClockOutTime,
            },
          });

          this.logger.warn(
            `Auto clocked out ${entry.user.name} - exceeded ${maxShiftHours}hr max (Entry: ${entry.id})`,
          );
        }

        if (overdueEntries.length > 0) {
          this.logger.log(
            `Company ${company.id}: Auto clocked out ${overdueEntries.length} entries`,
          );
        }
      }
    } catch (error) {
      this.logger.error('Auto clock-out job failed:', error);
    }
  }

  // Run at midnight to clean up any stragglers
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleMidnightCleanup() {
    this.logger.log('Running midnight cleanup...');
    await this.handleAutoClockOut();
  }
}
