import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JobsService } from '../jobs/jobs.service';
import { AwsService } from '../aws/aws.service';
import { EmailService } from '../email/email.service';
import { AuditService } from '../audit/audit.service';
import { BreakComplianceService } from '../break-compliance/break-compliance.service';
import { ClockInDto, ClockOutDto } from './dto';
import { CreateManualEntryDto } from './dto/create-manual-entry.dto';
import { Decimal } from '@prisma/client/runtime/library';
import * as ExcelJS from 'exceljs';
import * as PDFDocument from 'pdfkit';

@Injectable()
export class TimeEntriesService {
  constructor(
    private prisma: PrismaService,
    private jobsService: JobsService,
    private awsService: AwsService,
    private emailService: EmailService,
    private auditService: AuditService,
    private breakComplianceService: BreakComplianceService,
  ) {}

  async clockIn(userId: string, companyId: string, dto: ClockInDto) {
    const activeEntry = await this.prisma.timeEntry.findFirst({
      where: { userId, companyId, clockOutTime: null },
    });

    if (activeEntry) {
      throw new BadRequestException('You are already clocked in. Please clock out first.');
    }

    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { settings: true },
    });

    const { getToggles, isInLearningMode } = await import('../common/feature-toggles');
    const toggles = getToggles(company?.settings || {});
    const learningMode = isInLearningMode(toggles);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    let jobName = 'Unknown';
    const flagReasons: string[] = [];
    let jobId: string | null = null;

    if (dto.entryType === 'JOB_TIME') {
      if (!toggles.jobBasedTracking) {
        throw new BadRequestException('Job-based tracking is disabled for this company.');
      }

      if (!dto.jobId) {
        throw new BadRequestException('Job ID is required for job time entries');
      }

      const job = await this.jobsService.findOne(companyId, dto.jobId);
      jobName = job.name;

      if (toggles.gpsGeofencing !== 'off') {
        const [jobLat, jobLng] = job.geofenceCenter.split(',').map(Number);

        const geofenceCheck = this.jobsService.isWithinGeofence(
          jobLat,
          jobLng,
          job.geofenceRadiusMeters,
          dto.latitude,
          dto.longitude,
        );

        if (!geofenceCheck.isWithin) {
          if (toggles.gpsGeofencing === 'strict') {
            throw new ForbiddenException(
              `Clock-in denied: You are ${geofenceCheck.distance}m from the job site. Must be within ${job.geofenceRadiusMeters}m.`,
            );
          } else {
            flagReasons.push(`GPS_OUTSIDE_GEOFENCE: ${geofenceCheck.distance}m from job site`);
          }
        }
      }

      jobId = dto.jobId;
    }

    if (toggles.earlyClockInRestriction !== 'off' && toggles.shiftScheduling) {
      const now = new Date();
      const todayStart = new Date(now);
      todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date(now);
      todayEnd.setHours(23, 59, 59, 999);

      const todayShift = await this.prisma.shift.findFirst({
        where: {
          userId,
          companyId,
          shiftDate: { gte: todayStart, lte: todayEnd },
          status: { notIn: ['CANCELLED', 'COMPLETED'] },
        },
        orderBy: { startTime: 'asc' },
      });

      if (todayShift) {
        const shiftStartTime = new Date(todayShift.startTime);
        const earliestClockIn = new Date(shiftStartTime.getTime() - (toggles.earlyClockInMinutes * 60 * 1000));

        if (now < earliestClockIn) {
          const minutesUntilAllowed = Math.ceil((earliestClockIn.getTime() - now.getTime()) / 1000 / 60);
          const shiftTimeStr = shiftStartTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

          if (toggles.earlyClockInRestriction === 'strict') {
            throw new ForbiddenException(
              `You cannot clock in yet. Your shift starts at ${shiftTimeStr}. You can clock in ${toggles.earlyClockInMinutes} minutes before your shift (in ${minutesUntilAllowed} minutes).`
            );
          } else {
            flagReasons.push(`EARLY_CLOCK_IN: ${minutesUntilAllowed} minutes before allowed time`);
          }
        }
      }
    }

    const photoUrl = toggles.photoCapture ? 'verified-locally' : null;

    const timeEntry = await this.prisma.timeEntry.create({
      data: {
        companyId,
        userId,
        jobId,
        clockInTime: new Date(),
        clockInLocation: `${dto.latitude},${dto.longitude}`,
        clockInPhotoUrl: photoUrl,
        isFlagged: flagReasons.length > 0,
        flagReason: flagReasons.length > 0 ? flagReasons.join(', ') : null,
        approvalStatus: (flagReasons.length > 0 || dto.workerType === 'CONTRACTOR' || dto.workerType === 'VOLUNTEER') ? 'PENDING' : 'APPROVED',
        workerType: dto.workerType as any,
      },
      include: {
        job: true,
        user: { select: { id: true, name: true, phone: true } },
      },
    });

    if (toggles.facialRecognition !== 'off' && toggles.photoCapture && dto.photoUrl && dto.photoUrl !== 'placeholder.jpg') {
      if (!user?.referencePhotoUrl) {
        console.log(`First clock-in for user ${userId}, storing reference photo`);
        await this.prisma.user.update({
          where: { id: userId },
          data: { referencePhotoUrl: dto.photoUrl },
        });
      } else {
        try {
          const confidence = await this.awsService.compareFaces(
            user.referencePhotoUrl,
            dto.photoUrl,
          );

          const matched = confidence >= 92;

          await this.prisma.faceVerificationLog.create({
            data: {
              companyId,
              userId,
              timeEntryId: timeEntry.id,
              submittedPhotoUrl: 'verified-locally',
              confidenceScore: confidence,
              matched,
              rekognitionResponse: { confidence, matched },
            },
          });

          if (!matched) {
            if (toggles.facialRecognition === 'strict') {
              await this.prisma.timeEntry.delete({
                where: { id: timeEntry.id },
              });

              if (toggles.buddyPunchAlerts && !learningMode) {
                const admins = await this.prisma.user.findMany({
                  where: {
                    companyId,
                    role: { in: ['ADMIN', 'OWNER'] },
                    email: { not: null },
                  },
                  select: { email: true },
                });

                for (const admin of admins) {
                  if (admin.email) {
                    try {
                      await this.emailService.sendBuddyPunchAlert(
                        admin.email,
                        user.name,
                        user.phone,
                        jobName,
                        confidence,
                        'photo-not-stored',
                      );
                    } catch (emailErr) {
                      console.error('Failed to send buddy punch alert:', emailErr);
                    }
                  }
                }
              }

              throw new ForbiddenException(
                `Face verification failed. Confidence: ${confidence.toFixed(1)}%. Please try again or contact your supervisor.`,
              );
            } else {
              await this.prisma.timeEntry.update({
                where: { id: timeEntry.id },
                data: {
                  isFlagged: true,
                  flagReason: timeEntry.flagReason 
                    ? `${timeEntry.flagReason}, FACE_MISMATCH: ${confidence.toFixed(1)}%`
                    : `FACE_MISMATCH: ${confidence.toFixed(1)}%`,
                  approvalStatus: 'PENDING',
                },
              });

              if (toggles.buddyPunchAlerts && !learningMode) {
                const admins = await this.prisma.user.findMany({
                  where: {
                    companyId,
                    role: { in: ['ADMIN', 'OWNER'] },
                    email: { not: null },
                  },
                  select: { email: true },
                });

                for (const admin of admins) {
                  if (admin.email) {
                    try {
                      await this.emailService.sendBuddyPunchAlert(
                        admin.email,
                        user.name,
                        user.phone,
                        jobName,
                        confidence,
                        'photo-not-stored',
                      );
                    } catch (emailErr) {
                      console.error('Failed to send buddy punch alert:', emailErr);
                    }
                  }
                }
              }
            }
          }
        } catch (err) {
          if (err instanceof ForbiddenException) {
            throw err;
          }

          console.error('Face verification error:', err);
          await this.prisma.timeEntry.update({
            where: { id: timeEntry.id },
            data: {
              isFlagged: true,
              flagReason: 'FACE_VERIFICATION_ERROR',
              approvalStatus: 'PENDING',
            },
          });
        }
      }
    }

    return timeEntry;
  }

  async clockOut(userId: string, companyId: string, dto: ClockOutDto) {
    const activeEntry = await this.prisma.timeEntry.findFirst({
      where: { userId, companyId, clockOutTime: null },
      include: { job: true },
    });

    if (!activeEntry) {
      throw new BadRequestException('No active clock-in found. Please clock in first.');
    }

    if (activeEntry.isOnBreak) {
      throw new BadRequestException('You are currently on break. Please end your break before clocking out.');
    }

    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { settings: true, overtimeSettings: true },
    });

    const { getToggles } = await import('../common/feature-toggles');
    const toggles = getToggles(company?.settings || {});

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { workerTypes: true, hourlyRate: true },
    });

    const entryWorkerType = (activeEntry as any).workerType || 'HOURLY';
    const shouldCalculateOT = entryWorkerType === 'HOURLY' && toggles.overtimeCalculations;

    const clockInTime = new Date(activeEntry.clockInTime);
    const clockOutTime = new Date();
    const totalMinutes = Math.round((clockOutTime.getTime() - clockInTime.getTime()) / 1000 / 60);
    const workMinutes = totalMinutes - (activeEntry.breakMinutes || 0);

    const photoUrl = 'verified-locally';

    let overtimeCalc = {
      regularMinutes: workMinutes,
      overtimeMinutes: 0,
      doubleTimeMinutes: 0,
      hourlyRate: user?.hourlyRate ? Number(user.hourlyRate) : null,
      laborCost: null as number | null,
    };

    if (shouldCalculateOT) {
      overtimeCalc = await this.calculateOvertimeForEntry(
        userId,
        companyId,
        activeEntry.jobId,
        clockInTime,
        workMinutes,
        toggles,
      );
    } else if (overtimeCalc.hourlyRate) {
      overtimeCalc.laborCost = (workMinutes / 60) * overtimeCalc.hourlyRate;
    }

    const updatedEntry = await this.prisma.timeEntry.update({
      where: { id: activeEntry.id },
      data: {
        clockOutTime,
        clockOutLocation: `${dto.latitude},${dto.longitude}`,
        clockOutPhotoUrl: photoUrl,
        durationMinutes: workMinutes,
        regularMinutes: overtimeCalc.regularMinutes,
        overtimeMinutes: overtimeCalc.overtimeMinutes,
        doubleTimeMinutes: overtimeCalc.doubleTimeMinutes,
        hourlyRate: overtimeCalc.hourlyRate ? new Decimal(overtimeCalc.hourlyRate) : null,
        laborCost: overtimeCalc.laborCost ? new Decimal(overtimeCalc.laborCost) : null,
      },
      include: {
        job: true,
        user: { select: { id: true, name: true, phone: true } },
      },
    });

    if (toggles.breakTracking && entryWorkerType === 'HOURLY') {
      try {
        const breakSettings = await this.breakComplianceService.getComplianceSettings(companyId);
        const complianceResult = this.breakComplianceService.checkCompliance(
          workMinutes,
          activeEntry.breakMinutes || 0,
          0,
          breakSettings,
        );

        if (!complianceResult.isCompliant) {
          await this.breakComplianceService.recordViolations(
            companyId,
            userId,
            activeEntry.id,
            complianceResult.violations,
            overtimeCalc.hourlyRate,
          );
        }
      } catch (err) {
        console.error('Break compliance check error:', err);
      }
    }

    return updatedEntry;
  }

  private async calculateOvertimeForEntry(
    userId: string,
    companyId: string,
    jobId: string | null,
    clockInTime: Date,
    workMinutes: number,
    toggles?: any,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { hourlyRate: true },
    });

    let hourlyRate: number | null = null;

    if (jobId) {
      const jobRate = await this.prisma.workerJobRate.findFirst({
        where: { userId, jobId },
      });
      if (jobRate) {
        hourlyRate = Number(jobRate.hourlyRate);
      } else {
        const job = await this.prisma.job.findUnique({
          where: { id: jobId },
          select: { defaultHourlyRate: true },
        });
        if (job?.defaultHourlyRate) {
          hourlyRate = Number(job.defaultHourlyRate);
        }
      }
    }

    if (!hourlyRate && user?.hourlyRate) {
      hourlyRate = Number(user.hourlyRate);
    }

    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { overtimeSettings: true },
    });

    const otSettings = (company?.overtimeSettings as any) || {};
    const dailyRegularLimit = otSettings.dailyOtThreshold ?? 480;
    const dailyOvertimeLimit = otSettings.dailyDtThreshold ?? 720;
    const weeklyRegularLimit = otSettings.weeklyOtThreshold ?? 2400;
    const otMultiplier = otSettings.otMultiplier ?? 1.5;
    const dtMultiplier = otSettings.dtMultiplier ?? 2.0;

    const dayStart = new Date(clockInTime);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(clockInTime);
    dayEnd.setHours(23, 59, 59, 999);

    // FIXED: Added isArchived: false filter
    const dailyEntries = await this.prisma.timeEntry.findMany({
      where: {
        userId,
        companyId,
        clockInTime: { gte: dayStart, lte: dayEnd },
        clockOutTime: { not: null },
        isArchived: false,
      },
      select: { durationMinutes: true },
    });

    const previousDailyMinutes = dailyEntries.reduce((sum, e) => sum + (e.durationMinutes || 0), 0);
    const totalDailyMinutes = previousDailyMinutes + workMinutes;

    const workweekStartDay = otSettings.workweekStartDay ?? 0;
    const currentDayOfWeek = clockInTime.getDay();
    const daysFromWeekStart = (currentDayOfWeek - workweekStartDay + 7) % 7;
    
    const weekStart = new Date(clockInTime);
    weekStart.setDate(weekStart.getDate() - daysFromWeekStart);
    weekStart.setHours(0, 0, 0, 0);

    // FIXED: Added isArchived: false filter
    const weeklyEntries = await this.prisma.timeEntry.findMany({
      where: {
        userId,
        companyId,
        clockInTime: { gte: weekStart, lt: dayStart },
        clockOutTime: { not: null },
        isArchived: false,
      },
      select: { durationMinutes: true },
    });

    const previousWeeklyMinutes = weeklyEntries.reduce((sum, e) => sum + (e.durationMinutes || 0), 0);
    const totalWeeklyMinutes = previousWeeklyMinutes + previousDailyMinutes + workMinutes;

    let is7thConsecutiveDay = false;
    if (toggles?.seventhDayOtRule !== false) {
      is7thConsecutiveDay = await this.check7thConsecutiveDay(userId, companyId, clockInTime);
    }

    let regularMinutes = workMinutes;
    let overtimeMinutes = 0;
    let doubleTimeMinutes = 0;

    if (is7thConsecutiveDay) {
      if (totalDailyMinutes > dailyRegularLimit) {
        const dtMinutes = totalDailyMinutes - dailyRegularLimit;
        doubleTimeMinutes = Math.min(dtMinutes, workMinutes);
        overtimeMinutes = workMinutes - doubleTimeMinutes;
        regularMinutes = 0;
      } else {
        overtimeMinutes = workMinutes;
        regularMinutes = 0;
      }
    } else {
      let dailyRegular = workMinutes;
      let dailyOT = 0;
      let dailyDT = 0;

      if (totalDailyMinutes > dailyOvertimeLimit) {
        const dtMinutes = totalDailyMinutes - dailyOvertimeLimit;
        dailyDT = Math.min(dtMinutes, workMinutes);

        const remainingWork = workMinutes - dailyDT;
        if (previousDailyMinutes < dailyOvertimeLimit) {
          const otMinutesInRange = Math.min(
            dailyOvertimeLimit - Math.max(previousDailyMinutes, dailyRegularLimit),
            remainingWork
          );
          dailyOT = Math.max(0, otMinutesInRange);
          dailyRegular = remainingWork - dailyOT;
        } else {
          dailyRegular = 0;
          dailyOT = remainingWork;
        }
      } else if (totalDailyMinutes > dailyRegularLimit) {
        if (previousDailyMinutes >= dailyRegularLimit) {
          dailyOT = workMinutes;
          dailyRegular = 0;
        } else {
          dailyRegular = Math.max(0, dailyRegularLimit - previousDailyMinutes);
          dailyOT = workMinutes - dailyRegular;
        }
      }

      let weeklyRegular = workMinutes;
      let weeklyOT = 0;

      const previousWeeklyTotal = previousWeeklyMinutes + previousDailyMinutes;
      
      if (totalWeeklyMinutes > weeklyRegularLimit) {
        if (previousWeeklyTotal >= weeklyRegularLimit) {
          weeklyOT = workMinutes;
          weeklyRegular = 0;
        } else {
          weeklyRegular = Math.max(0, weeklyRegularLimit - previousWeeklyTotal);
          weeklyOT = workMinutes - weeklyRegular;
        }
      }

      const dailyOTValue = dailyOT * otMultiplier + dailyDT * dtMultiplier;
      const weeklyOTValue = weeklyOT * otMultiplier;

      if (dailyOTValue >= weeklyOTValue) {
        regularMinutes = dailyRegular;
        overtimeMinutes = dailyOT;
        doubleTimeMinutes = dailyDT;
      } else {
        regularMinutes = weeklyRegular;
        overtimeMinutes = weeklyOT;
        doubleTimeMinutes = 0;
      }

      if (dailyDT > 0 && weeklyOT > 0) {
        doubleTimeMinutes = dailyDT;
        const remainingAfterDT = workMinutes - dailyDT;
        
        const weeklyMinutesBeforeThisEntry = previousWeeklyMinutes + previousDailyMinutes;
        const weeklyMinutesAfterDT = weeklyMinutesBeforeThisEntry + remainingAfterDT;
        
        if (weeklyMinutesAfterDT > weeklyRegularLimit) {
          const weeklyOTForRemaining = Math.min(
            weeklyMinutesAfterDT - weeklyRegularLimit,
            remainingAfterDT
          );
          const dailyOTForRemaining = dailyOT;
          
          overtimeMinutes = Math.max(weeklyOTForRemaining, dailyOTForRemaining);
          regularMinutes = remainingAfterDT - overtimeMinutes;
        } else {
          overtimeMinutes = dailyOT;
          regularMinutes = dailyRegular;
        }
      }
    }

    let laborCost: number | null = null;
    if (hourlyRate) {
      const regularPay = (regularMinutes / 60) * hourlyRate;
      const overtimePay = (overtimeMinutes / 60) * hourlyRate * otMultiplier;
      const doubleTimePay = (doubleTimeMinutes / 60) * hourlyRate * dtMultiplier;
      laborCost = regularPay + overtimePay + doubleTimePay;
    }

    return {
      regularMinutes,
      overtimeMinutes,
      doubleTimeMinutes,
      hourlyRate,
      laborCost,
    };
  }

  // FIXED: Added isArchived: false filter
  private async check7thConsecutiveDay(
    userId: string,
    companyId: string,
    clockInTime: Date,
  ): Promise<boolean> {
    const currentDay = new Date(clockInTime);
    currentDay.setHours(0, 0, 0, 0);

    for (let i = 1; i <= 6; i++) {
      const checkDate = new Date(currentDay);
      checkDate.setDate(checkDate.getDate() - i);
      const checkDateEnd = new Date(checkDate);
      checkDateEnd.setHours(23, 59, 59, 999);

      const workedThatDay = await this.prisma.timeEntry.findFirst({
        where: {
          userId,
          companyId,
          clockInTime: { gte: checkDate, lte: checkDateEnd },
          durationMinutes: { gt: 0 },
          isArchived: false,
        },
      });

      if (!workedThatDay) {
        return false;
      }
    }

    return true;
  }

  async startBreak(userId: string) {
    const activeEntry = await this.prisma.timeEntry.findFirst({
      where: { userId, clockOutTime: null },
    });

    if (!activeEntry) {
      throw new BadRequestException('You must be clocked in to start a break.');
    }

    if (activeEntry.isOnBreak) {
      throw new BadRequestException('You are already on a break.');
    }

    return this.prisma.timeEntry.update({
      where: { id: activeEntry.id },
      data: {
        isOnBreak: true,
        breakStartTime: new Date(),
      },
      include: {
        job: true,
        user: { select: { id: true, name: true, phone: true } },
      },
    });
  }

  async endBreak(userId: string) {
    const activeEntry = await this.prisma.timeEntry.findFirst({
      where: { userId, clockOutTime: null },
    });

    if (!activeEntry) {
      throw new BadRequestException('You must be clocked in to end a break.');
    }

    if (!activeEntry.isOnBreak) {
      throw new BadRequestException('You are not currently on a break.');
    }

    const breakStartTime = new Date(activeEntry.breakStartTime!);
    const breakEndTime = new Date();
    const breakDuration = Math.round((breakEndTime.getTime() - breakStartTime.getTime()) / 1000 / 60);
    const totalBreakMinutes = (activeEntry.breakMinutes || 0) + breakDuration;

    return this.prisma.timeEntry.update({
      where: { id: activeEntry.id },
      data: {
        isOnBreak: false,
        breakEndTime: breakEndTime,
        breakMinutes: totalBreakMinutes,
      },
      include: {
        job: true,
        user: { select: { id: true, name: true, phone: true } },
      },
    });
  }

  // FIXED: Added isArchived: false filter
  async getTimeEntries(companyId: string, filters?: any) {
    const where: any = { isArchived: false };

    if (companyId) where.companyId = companyId;
    if (filters?.userId) where.userId = filters.userId;
    if (filters?.jobId) where.jobId = filters.jobId;
    if (filters?.approvalStatus) where.approvalStatus = filters.approvalStatus;
    if (filters?.startDate || filters?.endDate) {
      where.clockInTime = {};
      if (filters.startDate) where.clockInTime.gte = filters.startDate;
      if (filters.endDate) {
        const endDate = new Date(filters.endDate);
        endDate.setHours(23, 59, 59, 999);
        where.clockInTime.lte = endDate;
      }
    }

    return this.prisma.timeEntry.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, phone: true, hourlyRate: true } },
        job: true,
        approvedBy: { select: { id: true, name: true } },
      },
      orderBy: { clockInTime: 'desc' },
    });
  }

  async getCurrentStatus(userId: string, companyId: string) {
    const activeEntry = await this.prisma.timeEntry.findFirst({
      where: { userId, clockOutTime: null },
      include: { job: true },
    });

    return {
      isClockedIn: !!activeEntry,
      isOnBreak: activeEntry?.isOnBreak || false,
      activeEntry: activeEntry || null,
    };
  }

  // FIXED: Added isArchived: false filter
  async getPendingApprovals(companyId: string) {
    return this.prisma.timeEntry.findMany({
      where: {
        companyId,
        approvalStatus: 'PENDING',
        clockOutTime: { not: null },
        isArchived: false,
      },
      include: {
        user: { select: { id: true, name: true, phone: true } },
        job: true,
      },
      orderBy: { clockInTime: 'desc' },
    });
  }

  // FIXED: Added isArchived: false filter to all counts
  async getApprovalStats(companyId: string) {
    const [pending, approved, rejected] = await Promise.all([
      this.prisma.timeEntry.count({
        where: { companyId, approvalStatus: 'PENDING', clockOutTime: { not: null }, isArchived: false },
      }),
      this.prisma.timeEntry.count({
        where: { companyId, approvalStatus: 'APPROVED', isArchived: false },
      }),
      this.prisma.timeEntry.count({
        where: { companyId, approvalStatus: 'REJECTED', isArchived: false },
      }),
    ]);

    return { pending, approved, rejected };
  }

  async approveEntry(entryId: string, approverId: string, companyId: string) {
    const entry = await this.prisma.timeEntry.findFirst({
      where: { id: entryId, companyId },
      include: { user: { select: { id: true, name: true } } },
    });

    if (!entry) {
      throw new NotFoundException('Time entry not found');
    }

    if (entry.approvalStatus !== 'PENDING') {
      throw new BadRequestException(`Entry is already ${entry.approvalStatus.toLowerCase()}`);
    }

    if (!entry.clockOutTime) {
      throw new BadRequestException('Cannot approve an entry that is still active');
    }

    const updated = await this.prisma.timeEntry.update({
      where: { id: entryId },
      data: {
        approvalStatus: 'APPROVED',
        approvedById: approverId,
        approvedAt: new Date(),
        rejectionReason: null,
      },
      include: {
        user: { select: { id: true, name: true, phone: true } },
        job: true,
        approvedBy: { select: { id: true, name: true } },
      },
    });

    await this.auditService.log({
      companyId,
      userId: approverId,
      action: 'TIME_ENTRY_APPROVED',
      targetType: 'TIME_ENTRY',
      targetId: entryId,
      details: {
        workerName: entry.user?.name,
        workerId: entry.userId,
        durationMinutes: entry.durationMinutes,
      },
    });

    return updated;
  }

  async rejectEntry(entryId: string, approverId: string, companyId: string, reason?: string) {
    const entry = await this.prisma.timeEntry.findFirst({
      where: { id: entryId, companyId },
      include: { user: { select: { id: true, name: true } } },
    });

    if (!entry) {
      throw new NotFoundException('Time entry not found');
    }

    if (entry.approvalStatus !== 'PENDING') {
      throw new BadRequestException(`Entry is already ${entry.approvalStatus.toLowerCase()}`);
    }

    const updated = await this.prisma.timeEntry.update({
      where: { id: entryId },
      data: {
        approvalStatus: 'REJECTED',
        approvedById: approverId,
        approvedAt: new Date(),
        rejectionReason: reason || 'No reason provided',
      },
      include: {
        user: { select: { id: true, name: true, phone: true } },
        job: true,
        approvedBy: { select: { id: true, name: true } },
      },
    });

    await this.auditService.log({
      companyId,
      userId: approverId,
      action: 'TIME_ENTRY_REJECTED',
      targetType: 'TIME_ENTRY',
      targetId: entryId,
      details: {
        workerName: entry.user?.name,
        workerId: entry.userId,
        durationMinutes: entry.durationMinutes,
        rejectionReason: reason,
      },
    });

    return updated;
  }

  async bulkApprove(entryIds: string[], approverId: string, companyId: string) {
    const results = {
      approved: 0,
      failed: 0,
      errors: [] as string[],
    };

    for (const entryId of entryIds) {
      try {
        await this.approveEntry(entryId, approverId, companyId);
        results.approved++;
      } catch (err) {
        results.failed++;
        results.errors.push(`${entryId}: ${err.message}`);
      }
    }

    return results;
  }

  async bulkReject(entryIds: string[], approverId: string, companyId: string, reason: string) {
    const results = {
      rejected: 0,
      failed: 0,
      errors: [] as string[],
    };

    for (const entryId of entryIds) {
      try {
        await this.rejectEntry(entryId, approverId, companyId, reason);
        results.rejected++;
      } catch (err) {
        results.failed++;
        results.errors.push(`${entryId}: ${err.message}`);
      }
    }

    return results;
  }

  // FIXED: Added auto-approve logic
  async createManualEntry(companyId: string, createdById: string, dto: CreateManualEntryDto) {
    const user = await this.prisma.user.findFirst({
      where: { id: dto.userId, companyId },
    });

    if (!user) {
      throw new NotFoundException('Worker not found');
    }

    if (dto.jobId) {
      const job = await this.prisma.job.findFirst({
        where: { id: dto.jobId, companyId },
      });
      if (!job) {
        throw new NotFoundException('Job not found');
      }
    }

    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { settings: true },
    });

    const { getToggles } = await import('../common/feature-toggles');
    const toggles = getToggles(company?.settings || {});

    const entryWorkerType = dto.workerType || 'HOURLY';
    const shouldCalculateOT = entryWorkerType === 'HOURLY' && toggles.overtimeCalculations;
    const clockInTime = new Date(`${dto.date}T${dto.clockIn}:00.000Z`);
    const clockOutTime = new Date(`${dto.date}T${dto.clockOut}:00.000Z`);
    
    if (clockOutTime <= clockInTime) {
      throw new BadRequestException('Clock out time must be after clock in time');
    }

    const totalMinutes = Math.round((clockOutTime.getTime() - clockInTime.getTime()) / 1000 / 60);
    const workMinutes = totalMinutes - (dto.breakMinutes || 0);

    let overtimeCalc = {
      regularMinutes: workMinutes,
      overtimeMinutes: 0,
      doubleTimeMinutes: 0,
      hourlyRate: (user as any).hourlyRate ? Number((user as any).hourlyRate) : null,
      laborCost: null as number | null,
    };

    if (shouldCalculateOT) {
      overtimeCalc = await this.calculateOvertimeForEntry(
        dto.userId,
        companyId,
        dto.jobId || null,
        clockInTime,
        workMinutes,
        toggles,
      );
    } else if (overtimeCalc.hourlyRate) {
      overtimeCalc.laborCost = (workMinutes / 60) * overtimeCalc.hourlyRate;
    }

    // Determine worker type for this entry
    const entryWorkerType = dto.workerType || workerTypes[0] || 'HOURLY';
    
    // Get auto-approve settings from company
    const autoApproveSettings = (company?.settings as any)?.autoApprove || {
      hourly: true,
      salaried: true,
      contractor: false,
      volunteer: false,
    };
    
    // Determine approval status based on worker type
    let approvalStatus: 'PENDING' | 'APPROVED' = 'PENDING';
    
    if (entryWorkerType === 'HOURLY' && autoApproveSettings.hourly !== false) {
      approvalStatus = 'APPROVED';
    } else if (entryWorkerType === 'SALARIED' && autoApproveSettings.salaried !== false) {
      approvalStatus = 'APPROVED';
    } else if (entryWorkerType === 'CONTRACTOR' && autoApproveSettings.contractor === true) {
      approvalStatus = 'APPROVED';
    } else if (entryWorkerType === 'VOLUNTEER' && autoApproveSettings.volunteer === true) {
      approvalStatus = 'APPROVED';
    }

    const entry = await this.prisma.timeEntry.create({
      data: {
        companyId,
        userId: dto.userId,
        jobId: dto.jobId || null,
        clockInTime,
        clockOutTime,
        durationMinutes: workMinutes,
        breakMinutes: dto.breakMinutes || 0,
        restBreaksTaken: dto.restBreaksTaken || 0,
        notes: dto.notes,
        workerType: entryWorkerType as any,
        approvalStatus: approvalStatus,
        approvedById: approvalStatus === 'APPROVED' ? createdById : null,
        approvedAt: approvalStatus === 'APPROVED' ? new Date() : null,
        regularMinutes: overtimeCalc.regularMinutes,
        overtimeMinutes: overtimeCalc.overtimeMinutes,
        doubleTimeMinutes: overtimeCalc.doubleTimeMinutes,
        hourlyRate: overtimeCalc.hourlyRate ? new Decimal(overtimeCalc.hourlyRate) : null,
        laborCost: overtimeCalc.laborCost ? new Decimal(overtimeCalc.laborCost) : null,
      },
      include: {
        user: { select: { id: true, name: true, phone: true } },
        job: true,
      },
    });

    if (toggles.breakTracking && entryWorkerType === 'HOURLY') {
      try {
        const breakSettings = await this.breakComplianceService.getComplianceSettings(companyId);
        const complianceResult = this.breakComplianceService.checkCompliance(
          workMinutes,
          dto.breakMinutes || 0,
          dto.restBreaksTaken || 0,
          breakSettings,
        );

        if (!complianceResult.isCompliant) {
          await this.breakComplianceService.recordViolations(
            companyId,
            dto.userId,
            entry.id,
            complianceResult.violations,
            overtimeCalc.hourlyRate,
          );
        }
      } catch (err) {
        console.error('Break compliance check error:', err);
      }
    }

    await this.auditService.log({
      companyId,
      userId: createdById,
      action: 'TIME_ENTRY_APPROVED',
      targetType: 'TIME_ENTRY',
      targetId: entry.id,
      details: {
        type: 'MANUAL_ENTRY',
        workerName: user.name,
        durationMinutes: workMinutes,
      },
    });

    return entry;
  }

  // FIXED: Added isArchived: false filter
  async getOvertimeSummary(companyId: string, filters: { startDate?: Date; endDate?: Date }) {
    const where: any = { companyId, clockOutTime: { not: null }, isArchived: false };
    if (filters.startDate || filters.endDate) {
      where.clockInTime = {};
      if (filters.startDate) where.clockInTime.gte = filters.startDate;
      if (filters.endDate) {
        const endDate = new Date(filters.endDate);
        endDate.setHours(23, 59, 59, 999);
        where.clockInTime.lte = endDate;
      }
    }

    const entries = await this.prisma.timeEntry.findMany({
      where,
      include: {
        user: { select: { id: true, name: true } },
        job: { select: { id: true, name: true } },
      },
    });

    const byWorker: Record<string, any> = {};
    for (const entry of entries) {
      const workerId = entry.userId;
      if (!byWorker[workerId]) {
        byWorker[workerId] = {
          id: workerId,
          name: entry.user?.name || 'Unknown',
          regularMinutes: 0,
          overtimeMinutes: 0,
          doubleTimeMinutes: 0,
          regularPay: 0,
          overtimePay: 0,
          doubleTimePay: 0,
          totalPay: 0,
        };
      }
      const rate = entry.hourlyRate ? Number(entry.hourlyRate) : 0;
      byWorker[workerId].regularMinutes += entry.regularMinutes || 0;
      byWorker[workerId].overtimeMinutes += entry.overtimeMinutes || 0;
      byWorker[workerId].doubleTimeMinutes += entry.doubleTimeMinutes || 0;
      byWorker[workerId].regularPay += ((entry.regularMinutes || 0) / 60) * rate;
      byWorker[workerId].overtimePay += ((entry.overtimeMinutes || 0) / 60) * rate * 1.5;
      byWorker[workerId].doubleTimePay += ((entry.doubleTimeMinutes || 0) / 60) * rate * 2;
      byWorker[workerId].totalPay += entry.laborCost ? Number(entry.laborCost) : 0;
    }

    const byJobSite: Record<string, any> = {};
    for (const entry of entries) {
      const jobId = entry.jobId || 'unassigned';
      const jobName = entry.job?.name || 'Unassigned';
      
      if (!byJobSite[jobId]) {
        byJobSite[jobId] = {
          id: jobId,
          name: jobName,
          hours: 0,
          cost: 0,
          entries: 0,
          regularHours: 0,
          overtimeHours: 0,
          doubleTimeHours: 0,
        };
      }
      
      const totalMinutes = (entry.regularMinutes || 0) + (entry.overtimeMinutes || 0) + (entry.doubleTimeMinutes || 0);
      byJobSite[jobId].hours += totalMinutes / 60;
      byJobSite[jobId].cost += entry.laborCost ? Number(entry.laborCost) : 0;
      byJobSite[jobId].entries += 1;
      byJobSite[jobId].regularHours += (entry.regularMinutes || 0) / 60;
      byJobSite[jobId].overtimeHours += (entry.overtimeMinutes || 0) / 60;
      byJobSite[jobId].doubleTimeHours += (entry.doubleTimeMinutes || 0) / 60;
    }

    const totals = {
      regularHours: 0,
      overtimeHours: 0,
      doubleTimeHours: 0,
      regularPay: 0,
      overtimePay: 0,
      doubleTimePay: 0,
      totalPay: 0,
    };

    for (const worker of Object.values(byWorker)) {
      totals.regularHours += worker.regularMinutes / 60;
      totals.overtimeHours += worker.overtimeMinutes / 60;
      totals.doubleTimeHours += worker.doubleTimeMinutes / 60;
      totals.regularPay += worker.regularPay;
      totals.overtimePay += worker.overtimePay;
      totals.doubleTimePay += worker.doubleTimePay;
      totals.totalPay += worker.totalPay;
    }

    const sortedByJobSite = Object.values(byJobSite).sort((a: any, b: any) => b.cost - a.cost);

    return {
      byWorker: Object.values(byWorker),
      byJobSite: sortedByJobSite,
      totals,
    };
  }

  // FIXED: Added isArchived: false filter
  async exportToExcel(companyId: string, filters: { startDate?: Date; endDate?: Date; userId?: string }): Promise<Buffer> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
    });

    const where: any = { companyId, isArchived: false };

    if (filters.userId) {
      where.userId = filters.userId;
    }

    if (filters.startDate || filters.endDate) {
      where.clockInTime = {};
      if (filters.startDate) where.clockInTime.gte = filters.startDate;
      if (filters.endDate) {
        const endDate = new Date(filters.endDate);
        endDate.setHours(23, 59, 59, 999);
        where.clockInTime.lte = endDate;
      }
    }

    const entries = await this.prisma.timeEntry.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, phone: true, hourlyRate: true } },
        job: { select: { id: true, name: true, address: true } },
      },
      orderBy: [{ userId: 'asc' }, { clockInTime: 'asc' }],
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = company?.name || 'Punchd';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Timesheet');

    sheet.mergeCells('A1:L1');
    sheet.getCell('A1').value = company?.name || 'Company Timesheet';
    sheet.getCell('A1').font = { size: 18, bold: true };

    sheet.mergeCells('A2:L2');
    const startStr = filters.startDate
      ? new Date(filters.startDate).toLocaleDateString()
      : 'All Time';
    const endStr = filters.endDate
      ? new Date(filters.endDate).toLocaleDateString()
      : 'Present';
    sheet.getCell('A2').value = `Period: ${startStr} - ${endStr}`;

    const headers = ['Worker', 'Date', 'Job Site', 'Clock In', 'Clock Out', 'Break', 'Regular', 'OT', 'DT', 'Total', 'Rate', 'Amount', 'Status'];
    sheet.addRow([]);
    const headerRow = sheet.addRow(headers);
    headerRow.font = { bold: true };
    headerRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };
      cell.border = { bottom: { style: 'thin' } };
    });

    for (const entry of entries) {
      sheet.addRow([
        entry.user?.name || 'Unknown',
        entry.clockInTime ? new Date(entry.clockInTime).toLocaleDateString() : '-',
        entry.job?.name || 'Unassigned',
        entry.clockInTime ? new Date(entry.clockInTime).toLocaleTimeString() : '-',
        entry.clockOutTime ? new Date(entry.clockOutTime).toLocaleTimeString() : 'Active',
        entry.breakMinutes || 0,
        ((entry.regularMinutes || 0) / 60).toFixed(2),
        ((entry.overtimeMinutes || 0) / 60).toFixed(2),
        ((entry.doubleTimeMinutes || 0) / 60).toFixed(2),
        ((entry.durationMinutes || 0) / 60).toFixed(2),
        entry.hourlyRate ? `$${Number(entry.hourlyRate).toFixed(2)}` : '-',
        entry.laborCost ? `$${Number(entry.laborCost).toFixed(2)}` : '-',
        entry.approvalStatus || 'PENDING',
      ]);
    }

    sheet.columns.forEach((column) => {
      column.width = 15;
    });

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  // FIXED: Added isArchived: false filter
  async exportToPdf(companyId: string, filters: { startDate?: Date; endDate?: Date; userId?: string }): Promise<Buffer> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
    });

    const where: any = { companyId, isArchived: false };

    if (filters.userId) {
      where.userId = filters.userId;
    }

    if (filters.startDate || filters.endDate) {
      where.clockInTime = {};
      if (filters.startDate) where.clockInTime.gte = filters.startDate;
      if (filters.endDate) {
        const endDate = new Date(filters.endDate);
        endDate.setHours(23, 59, 59, 999);
        where.clockInTime.lte = endDate;
      }
    }

    const entries = await this.prisma.timeEntry.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, phone: true, hourlyRate: true } },
        job: { select: { id: true, name: true, address: true } },
      },
      orderBy: [{ userId: 'asc' }, { clockInTime: 'asc' }],
    });

    const doc = new PDFDocument({
      size: 'LETTER',
      layout: 'landscape',
      margin: 40,
    });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));

    const startStr = filters.startDate
      ? new Date(filters.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : 'All Time';
    const endStr = filters.endDate
      ? new Date(filters.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : 'Present';

    doc.fontSize(20).font('Helvetica-Bold').text(company?.name || 'Company Timesheet', 40, 40);

    if (company?.address) {
      doc.fontSize(10).font('Helvetica').text(
        `${company.address}${company.city ? ', ' + company.city : ''}${company.state ? ', ' + company.state : ''} ${company.zip || ''}`,
        40, 65
      );
    }

    doc.fontSize(14).font('Helvetica-Bold').text('TIMESHEET REPORT', 40, 90);
    doc.fontSize(10).font('Helvetica').text(`Period: ${startStr} - ${endStr}`, 40, 110);
    doc.text(`Generated: ${new Date().toLocaleString('en-US')}`, 40, 124);

    const workerGroups: Record<string, typeof entries> = {};
    for (const entry of entries) {
      const workerId = entry.userId;
      if (!workerGroups[workerId]) {
        workerGroups[workerId] = [];
      }
      workerGroups[workerId].push(entry);
    }

    let yPos = 155;
    const pageHeight = 612;
    const marginBottom = 60;

    const drawTableHeader = (y: number) => {
      doc.font('Helvetica-Bold').fontSize(8);
      doc.rect(40, y, 712, 18).fill('#e8e8e8').stroke('#cccccc');
      doc.fillColor('#000000');
      doc.text('Date', 45, y + 5, { width: 55 });
      doc.text('Job Site', 100, y + 5, { width: 120 });
      doc.text('In', 220, y + 5, { width: 50 });
      doc.text('Out', 270, y + 5, { width: 50 });
      doc.text('Break', 320, y + 5, { width: 35 });
      doc.text('Reg', 355, y + 5, { width: 35 });
      doc.text('OT', 390, y + 5, { width: 35 });
      doc.text('DT', 425, y + 5, { width: 35 });
      doc.text('Total', 460, y + 5, { width: 40 });
      doc.text('Rate', 500, y + 5, { width: 45 });
      doc.text('Amount', 545, y + 5, { width: 55 });
      doc.text('Status', 600, y + 5, { width: 50 });
      return y + 18;
    };

    for (const [workerId, workerEntries] of Object.entries(workerGroups)) {
      const worker = workerEntries[0]?.user;

      if (yPos > pageHeight - marginBottom - 100) {
        doc.addPage();
        yPos = 40;
      }

      doc.font('Helvetica-Bold').fontSize(11).fillColor('#333333');
      doc.text(`${worker?.name || 'Unknown Worker'}`, 40, yPos);
      doc.font('Helvetica').fontSize(9).fillColor('#666666');
      doc.text(`Rate: $${worker?.hourlyRate ? Number(worker.hourlyRate).toFixed(2) : '0.00'}/hr`, 300, yPos);
      yPos += 18;

      yPos = drawTableHeader(yPos);

      let workerTotalRegular = 0;
      let workerTotalOT = 0;
      let workerTotalDT = 0;
      let workerTotalPay = 0;

      doc.font('Helvetica').fontSize(8).fillColor('#000000');
      let rowIndex = 0;

      for (const entry of workerEntries) {
        if (yPos > pageHeight - marginBottom) {
          doc.addPage();
          yPos = 40;
          yPos = drawTableHeader(yPos);
        }

        if (rowIndex % 2 === 0) {
          doc.rect(40, yPos, 712, 16).fill('#fafafa');
        }
        doc.fillColor('#000000');

        const date = entry.clockInTime
          ? new Date(entry.clockInTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
          : '-';
        const clockIn = entry.clockInTime
          ? new Date(entry.clockInTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
          : '-';
        const clockOut = entry.clockOutTime
          ? new Date(entry.clockOutTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
          : 'Active';

        const regularHrs = ((entry.regularMinutes || 0) / 60).toFixed(1);
        const otHrs = ((entry.overtimeMinutes || 0) / 60).toFixed(1);
        const dtHrs = ((entry.doubleTimeMinutes || 0) / 60).toFixed(1);
        const totalHrs = ((entry.durationMinutes || 0) / 60).toFixed(1);
        const rate = entry.hourlyRate ? `$${Number(entry.hourlyRate).toFixed(2)}` : '-';
        const amount = entry.laborCost ? `$${Number(entry.laborCost).toFixed(2)}` : '-';

        workerTotalRegular += (entry.regularMinutes || 0) / 60;
        workerTotalOT += (entry.overtimeMinutes || 0) / 60;
        workerTotalDT += (entry.doubleTimeMinutes || 0) / 60;
        workerTotalPay += entry.laborCost ? Number(entry.laborCost) : 0;

        doc.text(date, 45, yPos + 4, { width: 55 });
        doc.text((entry.job?.name || 'Unassigned').substring(0, 18), 100, yPos + 4, { width: 120 });
        doc.text(clockIn, 220, yPos + 4, { width: 50 });
        doc.text(clockOut, 270, yPos + 4, { width: 50 });
        doc.text(`${entry.breakMinutes || 0}m`, 320, yPos + 4, { width: 35 });
        doc.text(regularHrs, 355, yPos + 4, { width: 35 });
        doc.text(otHrs, 390, yPos + 4, { width: 35 });
        doc.text(dtHrs, 425, yPos + 4, { width: 35 });
        doc.text(totalHrs, 460, yPos + 4, { width: 40 });
        doc.text(rate, 500, yPos + 4, { width: 45 });
        doc.text(amount, 545, yPos + 4, { width: 55 });

        const status = entry.approvalStatus || 'PENDING';
        const statusColor = status === 'APPROVED' ? '#22c55e' : status === 'REJECTED' ? '#ef4444' : '#f59e0b';
        doc.fillColor(statusColor).text(status, 600, yPos + 4, { width: 50 });
        doc.fillColor('#000000');

        yPos += 16;
        rowIndex++;
      }

      doc.rect(40, yPos, 712, 20).fill('#d4d4d4').stroke('#999999');
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#000000');
      doc.text('TOTAL', 45, yPos + 6);
      doc.text(workerTotalRegular.toFixed(1), 355, yPos + 6, { width: 35 });
      doc.text(workerTotalOT.toFixed(1), 390, yPos + 6, { width: 35 });
      doc.text(workerTotalDT.toFixed(1), 425, yPos + 6, { width: 35 });
      doc.text((workerTotalRegular + workerTotalOT + workerTotalDT).toFixed(1), 460, yPos + 6, { width: 40 });
      doc.text(`$${workerTotalPay.toFixed(2)}`, 545, yPos + 6, { width: 55 });
      yPos += 28;

      if (yPos < pageHeight - marginBottom - 40) {
        doc.font('Helvetica').fontSize(8).fillColor('#666666');
        doc.text('Worker Signature: _______________________________', 45, yPos);
        doc.text('Date: ____________', 300, yPos);
        doc.text('Manager: _______________________________', 450, yPos);
        yPos += 25;
      }
    }

    if (Object.keys(workerGroups).length > 0) {
      if (yPos > pageHeight - marginBottom - 50) {
        doc.addPage();
        yPos = 40;
      }

      let grandTotalHours = 0;
      let grandTotalPay = 0;
      for (const entry of entries) {
        grandTotalHours += (entry.durationMinutes || 0) / 60;
        grandTotalPay += entry.laborCost ? Number(entry.laborCost) : 0;
      }

      doc.rect(40, yPos, 712, 28).fill('#333333');
      doc.font('Helvetica-Bold').fontSize(12).fillColor('#ffffff');
      doc.text(`GRAND TOTAL: ${grandTotalHours.toFixed(1)} Hours | $${grandTotalPay.toFixed(2)}`, 50, yPos + 8);
      doc.text(`${entries.length} Entries | ${Object.keys(workerGroups).length} Workers`, 500, yPos + 8);
    }

    doc.end();

    return new Promise<Buffer>((resolve) => {
      doc.on('end', () => {
        resolve(Buffer.concat(chunks));
      });
    });
  }

  // FIXED: Added isArchived: false filter
  async exportToQuickBooks(
    companyId: string,
    filters: { startDate?: Date; endDate?: Date; format?: 'iif' | 'csv' }
  ): Promise<string> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
    });

    const where: any = { companyId, clockOutTime: { not: null }, isArchived: false };

    if (filters.startDate || filters.endDate) {
      where.clockInTime = {};
      if (filters.startDate) where.clockInTime.gte = filters.startDate;
      if (filters.endDate) {
        const endDate = new Date(filters.endDate);
        endDate.setHours(23, 59, 59, 999);
        where.clockInTime.lte = endDate;
      }
    }

    const entries = await this.prisma.timeEntry.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, phone: true, hourlyRate: true } },
        job: { select: { id: true, name: true, address: true } },
      },
      orderBy: [{ userId: 'asc' }, { clockInTime: 'asc' }],
    });

    if (filters.format === 'iif') {
      return this.generateQuickBooksIIF(entries, company?.name || 'Company');
    } else {
      return this.generateQuickBooksCSV(entries);
    }
  }

  private generateQuickBooksCSV(entries: any[]): string {
    const lines: string[] = [];
    
    lines.push([
      'Employee',
      'Customer:Job',
      'Service Item',
      'Date',
      'Regular Hours',
      'OT Hours',
      'DT Hours',
      'Total Hours',
      'Hourly Rate',
      'Regular Pay',
      'OT Pay',
      'DT Pay',
      'Total Pay',
      'Notes'
    ].join(','));

    for (const entry of entries) {
      const date = entry.clockInTime 
        ? new Date(entry.clockInTime).toLocaleDateString('en-US')
        : '';
      
      const regularHours = ((entry.regularMinutes || 0) / 60).toFixed(2);
      const otHours = ((entry.overtimeMinutes || 0) / 60).toFixed(2);
      const dtHours = ((entry.doubleTimeMinutes || 0) / 60).toFixed(2);
      const totalHours = ((entry.durationMinutes || 0) / 60).toFixed(2);
      
      const rate = entry.hourlyRate ? Number(entry.hourlyRate) : 0;
      const regularPay = ((entry.regularMinutes || 0) / 60) * rate;
      const otPay = ((entry.overtimeMinutes || 0) / 60) * rate * 1.5;
      const dtPay = ((entry.doubleTimeMinutes || 0) / 60) * rate * 2;
      const totalPay = entry.laborCost ? Number(entry.laborCost) : 0;

      const escapeCsv = (val: string) => {
        if (val && (val.includes(',') || val.includes('"') || val.includes('\n'))) {
          return `"${val.replace(/"/g, '""')}"`;
        }
        return val || '';
      };

      lines.push([
        escapeCsv(entry.user?.name || 'Unknown'),
        escapeCsv(entry.job?.name || 'Unassigned'),
        'Labor',
        date,
        regularHours,
        otHours,
        dtHours,
        totalHours,
        rate.toFixed(2),
        regularPay.toFixed(2),
        otPay.toFixed(2),
        dtPay.toFixed(2),
        totalPay.toFixed(2),
        escapeCsv(entry.notes || '')
      ].join(','));
    }

    return lines.join('\n');
  }

  private generateQuickBooksIIF(entries: any[], companyName: string): string {
    const lines: string[] = [];
    
    lines.push('!TIMERHDR\tVER\tREL\tCOMPANYNAME\tIMPORTEDBEFORE\tFROMTIMER\tCOMPANYCREATETIME');
    lines.push(`TIMERHDR\t8\t0\t${companyName}\tN\tY\t0`);
    
    lines.push('!TIMEACT\tDATE\tJOB\tEMP\tITEM\tDURATION\tPROJ\tNOTE\tBILLINGSTATUS');
    
    for (const entry of entries) {
      const date = entry.clockInTime 
        ? new Date(entry.clockInTime).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
        : '';
      
      const totalHours = ((entry.durationMinutes || 0) / 60).toFixed(2);
      const employeeName = entry.user?.name || 'Unknown';
      const jobName = entry.job?.name || '';
      const notes = entry.notes || '';

      lines.push([
        'TIMEACT',
        date,
        jobName,
        employeeName,
        'Labor',
        totalHours,
        jobName,
        notes.replace(/\t/g, ' ').replace(/\n/g, ' '),
        '0'
      ].join('\t'));
    }

    return lines.join('\r\n');
  }

  // FIXED: Added isArchived: false filter
  async exportToCsv(
    companyId: string,
    filters: { startDate?: Date; endDate?: Date }
  ): Promise<string> {
    const where: any = { companyId, clockOutTime: { not: null }, isArchived: false };

    if (filters.startDate || filters.endDate) {
      where.clockInTime = {};
      if (filters.startDate) where.clockInTime.gte = filters.startDate;
      if (filters.endDate) {
        const endDate = new Date(filters.endDate);
        endDate.setHours(23, 59, 59, 999);
        where.clockInTime.lte = endDate;
      }
    }

    const entries = await this.prisma.timeEntry.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, phone: true, hourlyRate: true } },
        job: { select: { id: true, name: true, address: true } },
      },
      orderBy: [{ userId: 'asc' }, { clockInTime: 'asc' }],
    });

    const lines: string[] = [];
    
    lines.push([
      'Employee Name',
      'Employee ID',
      'Date',
      'Location',
      'Clock In',
      'Clock Out',
      'Break (mins)',
      'Regular Hours',
      'Overtime Hours',
      'Double Time Hours',
      'Total Hours',
      'Hourly Rate',
      'Total Pay',
      'Status'
    ].join(','));

    for (const entry of entries) {
      const date = entry.clockInTime 
        ? new Date(entry.clockInTime).toLocaleDateString('en-US')
        : '';
      const clockIn = entry.clockInTime
        ? new Date(entry.clockInTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
        : '';
      const clockOut = entry.clockOutTime
        ? new Date(entry.clockOutTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
        : '';

      const escapeCsv = (val: string) => {
        if (val && (val.includes(',') || val.includes('"') || val.includes('\n'))) {
          return `"${val.replace(/"/g, '""')}"`;
        }
        return val || '';
      };

      lines.push([
        escapeCsv(entry.user?.name || 'Unknown'),
        entry.userId,
        date,
        escapeCsv(entry.job?.name || 'Unassigned'),
        clockIn,
        clockOut,
        (entry.breakMinutes || 0).toString(),
        ((entry.regularMinutes || 0) / 60).toFixed(2),
        ((entry.overtimeMinutes || 0) / 60).toFixed(2),
        ((entry.doubleTimeMinutes || 0) / 60).toFixed(2),
        ((entry.durationMinutes || 0) / 60).toFixed(2),
        entry.hourlyRate ? Number(entry.hourlyRate).toFixed(2) : '0.00',
        entry.laborCost ? Number(entry.laborCost).toFixed(2) : '0.00',
        entry.approvalStatus || 'PENDING'
      ].join(','));
    }

    return lines.join('\n');
  }

  // FIXED: Added isArchived: false filter
  async exportToAdp(
    companyId: string,
    filters: { startDate?: Date; endDate?: Date }
  ): Promise<string> {
    const where: any = { companyId, clockOutTime: { not: null }, approvalStatus: 'APPROVED', isArchived: false };

    if (filters.startDate || filters.endDate) {
      where.clockInTime = {};
      if (filters.startDate) where.clockInTime.gte = filters.startDate;
      if (filters.endDate) {
        const endDate = new Date(filters.endDate);
        endDate.setHours(23, 59, 59, 999);
        where.clockInTime.lte = endDate;
      }
    }

    const entries = await this.prisma.timeEntry.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, phone: true, hourlyRate: true } },
        job: { select: { id: true, name: true } },
      },
      orderBy: [{ userId: 'asc' }, { clockInTime: 'asc' }],
    });

    const lines: string[] = [];
    
    lines.push([
      'Co Code',
      'Batch ID',
      'File #',
      'Employee Name',
      'Reg Hours',
      'O/T Hours',
      'Hours 3 Code',
      'Hours 3 Amount',
      'Earnings 3 Code',
      'Earnings 3 Amount',
      'Memo Code',
      'Memo Amount'
    ].join(','));

    const byEmployee: Record<string, any[]> = {};
    for (const entry of entries) {
      const empId = entry.userId;
      if (!byEmployee[empId]) byEmployee[empId] = [];
      byEmployee[empId].push(entry);
    }

    for (const [empId, empEntries] of Object.entries(byEmployee)) {
      let totalRegular = 0;
      let totalOT = 0;
      let totalDT = 0;
      
      for (const entry of empEntries) {
        totalRegular += (entry.regularMinutes || 0) / 60;
        totalOT += (entry.overtimeMinutes || 0) / 60;
        totalDT += (entry.doubleTimeMinutes || 0) / 60;
      }

      const emp = empEntries[0]?.user;
      
      lines.push([
        '',
        '',
        empId.substring(0, 6),
        `"${emp?.name || 'Unknown'}"`,
        totalRegular.toFixed(2),
        totalOT.toFixed(2),
        totalDT > 0 ? 'DT' : '',
        totalDT > 0 ? totalDT.toFixed(2) : '',
        '',
        '',
        '',
        ''
      ].join(','));
    }

    return lines.join('\n');
  }

  // FIXED: Added isArchived: false filter
  async exportToGusto(
    companyId: string,
    filters: { startDate?: Date; endDate?: Date }
  ): Promise<string> {
    const where: any = { companyId, clockOutTime: { not: null }, approvalStatus: 'APPROVED', isArchived: false };

    if (filters.startDate || filters.endDate) {
      where.clockInTime = {};
      if (filters.startDate) where.clockInTime.gte = filters.startDate;
      if (filters.endDate) {
        const endDate = new Date(filters.endDate);
        endDate.setHours(23, 59, 59, 999);
        where.clockInTime.lte = endDate;
      }
    }

    const entries = await this.prisma.timeEntry.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, phone: true, hourlyRate: true } },
        job: { select: { id: true, name: true } },
      },
      orderBy: [{ userId: 'asc' }, { clockInTime: 'asc' }],
    });

    const lines: string[] = [];
    
    lines.push([
      'Employee First Name',
      'Employee Last Name',
      'Employee Email',
      'Pay Period Start',
      'Pay Period End',
      'Regular Hours',
      'Overtime Hours',
      'Double Overtime Hours',
      'PTO Hours',
      'Sick Hours',
      'Holiday Hours'
    ].join(','));

    const periodStart = filters.startDate 
      ? new Date(filters.startDate).toLocaleDateString('en-US')
      : '';
    const periodEnd = filters.endDate
      ? new Date(filters.endDate).toLocaleDateString('en-US')
      : '';

    const byEmployee: Record<string, any[]> = {};
    for (const entry of entries) {
      const empId = entry.userId;
      if (!byEmployee[empId]) byEmployee[empId] = [];
      byEmployee[empId].push(entry);
    }

    for (const [empId, empEntries] of Object.entries(byEmployee)) {
      let totalRegular = 0;
      let totalOT = 0;
      let totalDT = 0;
      
      for (const entry of empEntries) {
        totalRegular += (entry.regularMinutes || 0) / 60;
        totalOT += (entry.overtimeMinutes || 0) / 60;
        totalDT += (entry.doubleTimeMinutes || 0) / 60;
      }

      const emp = empEntries[0]?.user;
      const nameParts = (emp?.name || 'Unknown').split(' ');
      const firstName = nameParts[0] || '';
      const lastName = nameParts.slice(1).join(' ') || '';
      
      lines.push([
        `"${firstName}"`,
        `"${lastName}"`,
        '',
        periodStart,
        periodEnd,
        totalRegular.toFixed(2),
        totalOT.toFixed(2),
        totalDT.toFixed(2),
        '0.00',
        '0.00',
        '0.00'
      ].join(','));
    }

    return lines.join('\n');
  }

  // FIXED: Added isArchived: false filter
  async exportToPaychex(
    companyId: string,
    filters: { startDate?: Date; endDate?: Date }
  ): Promise<string> {
    const where: any = { companyId, clockOutTime: { not: null }, approvalStatus: 'APPROVED', isArchived: false };

    if (filters.startDate || filters.endDate) {
      where.clockInTime = {};
      if (filters.startDate) where.clockInTime.gte = filters.startDate;
      if (filters.endDate) {
        const endDate = new Date(filters.endDate);
        endDate.setHours(23, 59, 59, 999);
        where.clockInTime.lte = endDate;
      }
    }

    const entries = await this.prisma.timeEntry.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, phone: true, hourlyRate: true } },
        job: { select: { id: true, name: true } },
      },
      orderBy: [{ userId: 'asc' }, { clockInTime: 'asc' }],
    });

    const lines: string[] = [];
    
    lines.push([
      'Worker ID',
      'Last Name',
      'First Name',
      'Check Date',
      'Earnings Code',
      'Hours',
      'Rate',
      'Amount',
      'Department',
      'Location'
    ].join(','));

    for (const entry of entries) {
      const emp = entry.user;
      const nameParts = (emp?.name || 'Unknown').split(' ');
      const firstName = nameParts[0] || '';
      const lastName = nameParts.slice(1).join(' ') || '';
      const checkDate = entry.clockInTime 
        ? new Date(entry.clockInTime).toLocaleDateString('en-US')
        : '';
      const rate = entry.hourlyRate ? Number(entry.hourlyRate) : 0;

      const escapeCsv = (val: string) => {
        if (val && (val.includes(',') || val.includes('"') || val.includes('\n'))) {
          return `"${val.replace(/"/g, '""')}"`;
        }
        return val || '';
      };

      if ((entry.regularMinutes || 0) > 0) {
        const regHours = (entry.regularMinutes || 0) / 60;
        lines.push([
          entry.userId.substring(0, 10),
          escapeCsv(lastName),
          escapeCsv(firstName),
          checkDate,
          'REG',
          regHours.toFixed(2),
          rate.toFixed(2),
          (regHours * rate).toFixed(2),
          '',
          escapeCsv(entry.job?.name || '')
        ].join(','));
      }

      if ((entry.overtimeMinutes || 0) > 0) {
        const otHours = (entry.overtimeMinutes || 0) / 60;
        lines.push([
          entry.userId.substring(0, 10),
          escapeCsv(lastName),
          escapeCsv(firstName),
          checkDate,
          'OT',
          otHours.toFixed(2),
          (rate * 1.5).toFixed(2),
          (otHours * rate * 1.5).toFixed(2),
          '',
          escapeCsv(entry.job?.name || '')
        ].join(','));
      }

      if ((entry.doubleTimeMinutes || 0) > 0) {
        const dtHours = (entry.doubleTimeMinutes || 0) / 60;
        lines.push([
          entry.userId.substring(0, 10),
          escapeCsv(lastName),
          escapeCsv(firstName),
          checkDate,
          'DT',
          dtHours.toFixed(2),
          (rate * 2).toFixed(2),
          (dtHours * rate * 2).toFixed(2),
          '',
          escapeCsv(entry.job?.name || '')
        ].join(','));
      }
    }

    return lines.join('\n');
  }

  async updateEntry(
    entryId: string,
    companyId: string,
    editedById: string,
    updateData: {
      clockInTime?: string;
      clockOutTime?: string;
      breakMinutes?: number;
      restBreaksTaken?: number;
      jobId?: string;
      notes?: string;
    },
  ) {
    const entry = await this.prisma.timeEntry.findFirst({
      where: { id: entryId, companyId },
      include: { user: true, job: true },
    });

    if (!entry) {
      throw new NotFoundException('Time entry not found');
    }

    if (entry.isLocked) {
      throw new BadRequestException('Cannot edit a locked time entry. Unlock the pay period first.');
    }

    let isAmendedAfterExport = false;
    const payPeriod = await this.prisma.payPeriod.findFirst({
      where: {
        companyId,
        startDate: { lte: new Date(entry.clockInTime) },
        endDate: { gte: new Date(entry.clockInTime) },
      },
    });

    if (payPeriod?.status === 'EXPORTED') {
      isAmendedAfterExport = true;
    }

    const oldValues = {
      clockInTime: entry.clockInTime,
      clockOutTime: entry.clockOutTime,
      breakMinutes: entry.breakMinutes,
      restBreaksTaken: entry.restBreaksTaken,
      jobId: entry.jobId,
      notes: entry.notes,
    };

    const clockInTime = updateData.clockInTime 
      ? new Date(updateData.clockInTime) 
      : entry.clockInTime;
    const clockOutTime = updateData.clockOutTime 
      ? new Date(updateData.clockOutTime) 
      : entry.clockOutTime;
    const breakMinutes = updateData.breakMinutes ?? entry.breakMinutes ?? 0;
    const restBreaksTaken = updateData.restBreaksTaken ?? entry.restBreaksTaken ?? 0;

    if (clockOutTime && clockOutTime <= clockInTime) {
      throw new BadRequestException('Clock out time must be after clock in time');
    }

    if (clockOutTime) {
      const diffMs = clockOutTime.getTime() - clockInTime.getTime();
      const diffHours = diffMs / (1000 * 60 * 60);
      if (diffHours > 24) {
        throw new BadRequestException('Time entry cannot exceed 24 hours');
      }
    }

    let durationMinutes: number | null = null;
    let regularMinutes = 0;
    let overtimeMinutes = 0;
    let doubleTimeMinutes = 0;
    let laborCost: number | null = null;

    if (clockOutTime) {
      const diffMs = clockOutTime.getTime() - clockInTime.getTime();
      const totalMinutes = Math.round(diffMs / (1000 * 60));
      durationMinutes = totalMinutes - breakMinutes;

      const jobId = updateData.jobId !== undefined ? updateData.jobId : entry.jobId;
      const overtimeCalc = await this.calculateOvertimeForEntry(
        entry.userId,
        companyId,
        jobId,
        clockInTime,
        durationMinutes,
      );

      regularMinutes = overtimeCalc.regularMinutes;
      overtimeMinutes = overtimeCalc.overtimeMinutes;
      doubleTimeMinutes = overtimeCalc.doubleTimeMinutes;
      laborCost = overtimeCalc.laborCost;
    }

    const updatedEntry = await this.prisma.timeEntry.update({
      where: { id: entryId },
      data: {
        clockInTime,
        clockOutTime,
        breakMinutes,
        restBreaksTaken,
        jobId: updateData.jobId !== undefined ? (updateData.jobId || null) : entry.jobId,
        notes: updateData.notes !== undefined ? updateData.notes : entry.notes,
        durationMinutes,
        regularMinutes,
        overtimeMinutes,
        doubleTimeMinutes,
        laborCost: laborCost ? new Decimal(laborCost) : null,
        lastEditedById: editedById,
        amendedAfterExport: isAmendedAfterExport || entry.amendedAfterExport || false,
      },
      include: { 
        user: { select: { id: true, name: true, phone: true } }, 
        job: true,
        approvedBy: { select: { id: true, name: true } },
      },
    });

    if (durationMinutes && updatedEntry.clockOutTime) {
      try {
        await this.prisma.breakViolation.deleteMany({
          where: { timeEntryId: entryId },
        });

        const breakSettings = await this.breakComplianceService.getComplianceSettings(companyId);
        const complianceResult = this.breakComplianceService.checkCompliance(
          durationMinutes,
          breakMinutes,
          restBreaksTaken,
          breakSettings,
        );

        if (!complianceResult.isCompliant) {
          const hourlyRate = updatedEntry.hourlyRate ? Number(updatedEntry.hourlyRate) : null;
          await this.breakComplianceService.recordViolations(
            companyId,
            entry.userId,
            entryId,
            complianceResult.violations,
            hourlyRate,
          );
        }

        await this.prisma.timeEntry.update({
          where: { id: entryId },
          data: { breakCompliant: complianceResult.isCompliant },
        });
      } catch (err) {
        console.error('Break compliance re-check error:', err);
      }
    }

    await this.auditService.log({
      companyId,
      userId: editedById,
      action: 'TIME_ENTRY_EDITED',
      targetType: 'TIME_ENTRY',
      targetId: entryId,
      details: {
        entryId,
        workerName: entry.user?.name,
        workerId: entry.userId,
        oldValues: {
          clockInTime: oldValues.clockInTime?.toISOString(),
          clockOutTime: oldValues.clockOutTime?.toISOString(),
          breakMinutes: oldValues.breakMinutes,
          restBreaksTaken: oldValues.restBreaksTaken,
          jobId: oldValues.jobId,
          notes: oldValues.notes,
        },
        newValues: {
          clockInTime: updatedEntry.clockInTime?.toISOString(),
          clockOutTime: updatedEntry.clockOutTime?.toISOString(),
          breakMinutes: updatedEntry.breakMinutes,
          restBreaksTaken: updatedEntry.restBreaksTaken,
          jobId: updatedEntry.jobId,
          notes: updatedEntry.notes,
        },
        amendedAfterExport: isAmendedAfterExport,
      },
    });

    return updatedEntry;
  }

  async archiveEntry(
    entryId: string,
    companyId: string,
    archivedById: string,
    reason?: string,
  ) {
    const entry = await this.prisma.timeEntry.findFirst({
      where: { id: entryId, companyId },
      include: { user: { select: { id: true, name: true } } },
    });

    if (!entry) {
      throw new NotFoundException('Time entry not found');
    }

    if ((entry as any).isArchived) {
      throw new BadRequestException('Entry is already archived');
    }

    // Delete violations when archiving
    await this.prisma.breakViolation.deleteMany({
      where: { timeEntryId: entryId },
    });

    const updated = await this.prisma.timeEntry.update({
      where: { id: entryId },
      data: {
        isArchived: true,
        archivedAt: new Date(),
        archivedById,
        archiveReason: reason || null,
      },
      include: {
        user: { select: { id: true, name: true, phone: true } },
        job: true,
      },
    });

    await this.auditService.log({
      companyId,
      userId: archivedById,
      action: 'TIME_ENTRY_ARCHIVED',
      targetType: 'TIME_ENTRY',
      targetId: entryId,
      details: {
        workerName: entry.user?.name,
        workerId: entry.userId,
        reason,
      },
    });

    return updated;
  }

  // NEW: Get archived entries
  async getArchivedEntries(companyId: string, filters?: any) {
    const where: any = { companyId, isArchived: true };

    if (filters?.userId) where.userId = filters.userId;
    if (filters?.startDate || filters?.endDate) {
      where.clockInTime = {};
      if (filters.startDate) where.clockInTime.gte = filters.startDate;
      if (filters.endDate) {
        const endDate = new Date(filters.endDate);
        endDate.setHours(23, 59, 59, 999);
        where.clockInTime.lte = endDate;
      }
    }

    return this.prisma.timeEntry.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, phone: true, hourlyRate: true } },
        job: true,
      },
      orderBy: { archivedAt: 'desc' },
    });
  }

  // NEW: Restore archived entry
  async restoreEntry(entryId: string, companyId: string, restoredById: string) {
    const entry = await this.prisma.timeEntry.findFirst({
      where: { id: entryId, companyId, isArchived: true },
      include: { user: { select: { id: true, name: true } } },
    });

    if (!entry) {
      throw new NotFoundException('Archived entry not found');
    }

    const updated = await this.prisma.timeEntry.update({
      where: { id: entryId },
      data: {
        isArchived: false,
        archivedAt: null,
        archivedById: null,
        archiveReason: null,
      },
      include: {
        user: { select: { id: true, name: true, phone: true } },
        job: true,
      },
    });

    await this.auditService.log({
      companyId,
      userId: restoredById,
      action: 'TIME_ENTRY_ARCHIVED',
      targetType: 'TIME_ENTRY',
      targetId: entryId,
      details: {
        action: 'RESTORED',
        workerName: entry.user?.name,
        workerId: entry.userId,
        previousApprovalStatus: entry.approvalStatus,
      },
    });

    return updated;
  }
}
