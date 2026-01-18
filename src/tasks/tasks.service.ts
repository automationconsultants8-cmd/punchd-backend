import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { getToggles } from '../common/feature-toggles';

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
      const companies = await this.prisma.company.findMany({
        where: { isActive: true },
        select: { id: true, settings: true },
      });

      for (const company of companies) {
        const toggles = getToggles(company.settings || {});

        // Skip if auto clock-out is disabled
        if (!toggles.autoClockOut) {
          continue;
        }

        const maxShiftHours = toggles.maxShiftHours;
        const maxShiftMinutes = maxShiftHours * 60;

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
          const autoClockOutTime = new Date(entry.clockInTime);
          autoClockOutTime.setMinutes(autoClockOutTime.getMinutes() + maxShiftMinutes);

          await this.prisma.timeEntry.update({
            where: { id: entry.id },
            data: {
              clockOutTime: autoClockOutTime,
              durationMinutes: maxShiftMinutes,
              isFlagged: true,
              flagReason: `Auto clock-out: Exceeded ${maxShiftHours} hour maximum shift time`,
              approvalStatus: 'PENDING',
              notes: entry.notes
                ? `${entry.notes} | AUTO CLOCK-OUT: Worker did not clock out, auto-clocked after ${maxShiftHours} hours`
                : `AUTO CLOCK-OUT: Worker did not clock out, auto-clocked after ${maxShiftHours} hours`,
            },
          });

          await this.auditService.log({
            companyId: company.id,
            userId: undefined,
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

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleMidnightCleanup() {
    this.logger.log('Running midnight cleanup...');
    await this.handleAutoClockOut();
  }
}
