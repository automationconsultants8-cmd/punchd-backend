import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JobsService } from '../jobs/jobs.service';
import { AwsService } from '../aws/aws.service';
import { EmailService } from '../email/email.service';
import { AuditService } from '../audit/audit.service';
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
  ) {}

  async clockIn(userId: string, companyId: string, dto: ClockInDto) {
    const activeEntry = await this.prisma.timeEntry.findFirst({
      where: { userId, companyId, clockOutTime: null },
    });

    if (activeEntry) {
      throw new BadRequestException('You are already clocked in. Please clock out first.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    let jobName = 'Unknown';
    const flagReasons: string[] = [];
    let jobId: string | null = null;

    if (dto.entryType === 'JOB_TIME') {
      if (!dto.jobId) {
        throw new BadRequestException('Job ID is required for job time entries');
      }

      const job = await this.jobsService.findOne(companyId, dto.jobId);
      jobName = job.name;
      const [jobLat, jobLng] = job.geofenceCenter.split(',').map(Number);

      const geofenceCheck = this.jobsService.isWithinGeofence(
        jobLat,
        jobLng,
        job.geofenceRadiusMeters,
        dto.latitude,
        dto.longitude,
      );

      if (!geofenceCheck.isWithin) {
        flagReasons.push(
          `OUTSIDE_GEOFENCE: ${geofenceCheck.distance}m from job site (allowed: ${job.geofenceRadiusMeters}m)`,
        );
        throw new ForbiddenException(
          `Clock-in denied: You are ${geofenceCheck.distance}m from the job site. Must be within ${job.geofenceRadiusMeters}m.`,
        );
      }

      jobId = dto.jobId;
    }

    let photoUrl = 'placeholder.jpg';
    if (dto.photoUrl && dto.photoUrl !== 'placeholder.jpg') {
      try {
        photoUrl = await this.awsService.uploadPhoto(dto.photoUrl, userId, 'clock-in');
      } catch (err) {
        console.error('Failed to upload photo to S3:', err);
        flagReasons.push('PHOTO_UPLOAD_FAILED');
      }
    }

    const timeEntry = await this.prisma.timeEntry.create({
      data: {
        companyId,
        userId,
        jobId,
        clockInTime: new Date(),
        clockInLocation: `${dto.latitude},${dto.longitude}`,
        clockInPhotoUrl: photoUrl,
        isFlagged: flagReasons.length > 0,
        flagReason: flagReasons.join(', '),
        approvalStatus: 'PENDING',
      },
      include: {
        job: true,
        user: { select: { id: true, name: true, phone: true } },
      },
    });

    if (user?.referencePhotoUrl && photoUrl !== 'placeholder.jpg') {
      try {
        const confidence = await this.awsService.compareFaces(
          user.referencePhotoUrl,
          photoUrl,
        );

        const matched = confidence >= 80;

        await this.prisma.faceVerificationLog.create({
          data: {
            companyId,
            userId,
            timeEntryId: timeEntry.id,
            submittedPhotoUrl: photoUrl,
            confidenceScore: confidence,
            matched,
            rekognitionResponse: { confidence, matched },
          },
        });

        if (!matched) {
          await this.prisma.timeEntry.delete({
            where: { id: timeEntry.id },
          });

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
                  photoUrl,
                );
              } catch (emailErr) {
                console.error('Failed to send buddy punch alert:', emailErr);
              }
            }
          }

          throw new ForbiddenException(
            `Face verification failed. Confidence: ${confidence.toFixed(1)}%. Please try again or contact your supervisor.`,
          );
        }
      } catch (err) {
        if (err instanceof ForbiddenException) {
          throw err;
        }

        console.error('Face verification error:', err);
        const updatedFlagReasons = timeEntry.flagReason
          ? `${timeEntry.flagReason}, FACE_VERIFICATION_ERROR`
          : 'FACE_VERIFICATION_ERROR';

        await this.prisma.timeEntry.update({
          where: { id: timeEntry.id },
          data: {
            isFlagged: true,
            flagReason: updatedFlagReasons,
          },
        });
      }
    } else if (!user?.referencePhotoUrl && photoUrl !== 'placeholder.jpg') {
      await this.prisma.user.update({
        where: { id: userId },
        data: { referencePhotoUrl: photoUrl },
      });
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

    const clockInTime = new Date(activeEntry.clockInTime);
    const clockOutTime = new Date();
    const totalMinutes = Math.round((clockOutTime.getTime() - clockInTime.getTime()) / 1000 / 60);
    const workMinutes = totalMinutes - (activeEntry.breakMinutes || 0);

    let photoUrl = 'placeholder.jpg';
    if (dto.photoUrl && dto.photoUrl !== 'placeholder.jpg') {
      try {
        photoUrl = await this.awsService.uploadPhoto(dto.photoUrl, userId, 'clock-out');
      } catch (err) {
        console.error('Failed to upload photo to S3:', err);
      }
    }

    // Calculate overtime and labor cost
    const overtimeCalc = await this.calculateOvertimeForEntry(
      userId,
      companyId,
      activeEntry.jobId,
      clockInTime,
      workMinutes,
    );

    return this.prisma.timeEntry.update({
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
  }

  private async calculateOvertimeForEntry(
    userId: string,
    companyId: string,
    jobId: string | null,
    clockInTime: Date,
    workMinutes: number,
  ) {
    // Get effective rate
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { hourlyRate: true },
    });

    let effectiveRate: number | null = null;

    if (jobId) {
      const jobRate = await this.prisma.workerJobRate.findFirst({
        where: { userId, jobId },
      });
      if (jobRate) {
        effectiveRate = Number(jobRate.hourlyRate);
      } else {
        const job = await this.prisma.job.findUnique({
          where: { id: jobId },
          select: { defaultHourlyRate: true },
        });
        if (job?.defaultHourlyRate) {
          effectiveRate = Number(job.defaultHourlyRate);
        }
      }
    }

    if (!effectiveRate && user?.hourlyRate) {
      effectiveRate = Number(user.hourlyRate);
    }

    // Get all entries for this day to calculate daily overtime
    const dayStart = new Date(clockInTime);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(clockInTime);
    dayEnd.setHours(23, 59, 59, 999);

    const dailyEntries = await this.prisma.timeEntry.findMany({
      where: {
        userId,
        companyId,
        clockInTime: { gte: dayStart, lte: dayEnd },
        clockOutTime: { not: null },
      },
      select: { durationMinutes: true },
    });

    const previousDailyMinutes = dailyEntries.reduce((sum, e) => sum + (e.durationMinutes || 0), 0);
    const totalDailyMinutes = previousDailyMinutes + workMinutes;

    // Calculate daily overtime (CA rules: >8hrs = 1.5x, >12hrs = 2x)
    let regularMinutes = workMinutes;
    let overtimeMinutes = 0;
    let doubleTimeMinutes = 0;

    const dailyRegularLimit = 8 * 60; // 480 minutes
    const dailyOvertimeLimit = 12 * 60; // 720 minutes

    if (totalDailyMinutes > dailyOvertimeLimit) {
      // Some double time
      const dtMinutes = totalDailyMinutes - dailyOvertimeLimit;
      doubleTimeMinutes = Math.min(dtMinutes, workMinutes);
      
      const remainingWork = workMinutes - doubleTimeMinutes;
      if (previousDailyMinutes < dailyOvertimeLimit) {
        const otMinutesInRange = Math.min(dailyOvertimeLimit - Math.max(previousDailyMinutes, dailyRegularLimit), remainingWork);
        overtimeMinutes = Math.max(0, otMinutesInRange);
        regularMinutes = remainingWork - overtimeMinutes;
      } else {
        regularMinutes = 0;
        overtimeMinutes = remainingWork;
      }
    } else if (totalDailyMinutes > dailyRegularLimit) {
      // Some overtime, no double time
      if (previousDailyMinutes >= dailyRegularLimit) {
        overtimeMinutes = workMinutes;
        regularMinutes = 0;
      } else {
        regularMinutes = Math.max(0, dailyRegularLimit - previousDailyMinutes);
        overtimeMinutes = workMinutes - regularMinutes;
      }
    }

    // Calculate labor cost
    let laborCost: number | null = null;
    if (effectiveRate) {
      const regularPay = (regularMinutes / 60) * effectiveRate;
      const overtimePay = (overtimeMinutes / 60) * effectiveRate * 1.5;
      const doubleTimePay = (doubleTimeMinutes / 60) * effectiveRate * 2;
      laborCost = regularPay + overtimePay + doubleTimePay;
    }

    return {
      regularMinutes,
      overtimeMinutes,
      doubleTimeMinutes,
      effectiveRate,
      laborCost,
    };
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

  async getTimeEntries(companyId: string, filters?: any) {
    const where: any = {};

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

  // ============ APPROVAL WORKFLOW METHODS ============

  async getPendingApprovals(companyId: string) {
    return this.prisma.timeEntry.findMany({
      where: {
        companyId,
        approvalStatus: 'PENDING',
        clockOutTime: { not: null },
      },
      include: {
        user: { select: { id: true, name: true, phone: true } },
        job: true,
      },
      orderBy: { clockInTime: 'desc' },
    });
  }

  async getApprovalStats(companyId: string) {
    const [pending, approved, rejected] = await Promise.all([
      this.prisma.timeEntry.count({
        where: { companyId, approvalStatus: 'PENDING', clockOutTime: { not: null } },
      }),
      this.prisma.timeEntry.count({
        where: { companyId, approvalStatus: 'APPROVED' },
      }),
      this.prisma.timeEntry.count({
        where: { companyId, approvalStatus: 'REJECTED' },
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

    const clockInTime = new Date(`${dto.date}T${dto.clockIn}:00`);
    const clockOutTime = new Date(`${dto.date}T${dto.clockOut}:00`);

    if (clockOutTime <= clockInTime) {
      throw new BadRequestException('Clock out time must be after clock in time');
    }

    const totalMinutes = Math.round((clockOutTime.getTime() - clockInTime.getTime()) / 1000 / 60);
    const workMinutes = totalMinutes - (dto.breakMinutes || 0);

    const overtimeCalc = await this.calculateOvertimeForEntry(
      dto.userId,
      companyId,
      dto.jobId || null,
      clockInTime,
      workMinutes,
    );

    const entry = await this.prisma.timeEntry.create({
      data: {
        companyId,
        userId: dto.userId,
        jobId: dto.jobId || null,
        clockInTime,
        clockOutTime,
        durationMinutes: workMinutes,
        breakMinutes: dto.breakMinutes || 0,
        notes: dto.notes,
        approvalStatus: 'PENDING',
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

  // ============ OVERTIME SUMMARY ============

  async getOvertimeSummary(companyId: string, filters: { startDate?: Date; endDate?: Date }) {
    const where: any = { companyId, clockOutTime: { not: null } };

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

    return {
      byWorker: Object.values(byWorker),
      totals,
    };
  }

  // ============ EXPORT METHODS ============

  async exportToExcel(companyId: string, filters: { startDate?: Date; endDate?: Date; userId?: string }) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
    });

    const where: any = { companyId };

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

    // Header
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

    // Column headers
    const headers = ['Worker', 'Date', 'Job Site', 'Clock In', 'Clock Out', 'Break', 'Regular', 'OT', 'DT', 'Total', 'Rate', 'Amount', 'Status'];
    sheet.addRow([]);
    const headerRow = sheet.addRow(headers);
    headerRow.font = { bold: true };
    headerRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };
      cell.border = { bottom: { style: 'thin' } };
    });

    // Data rows
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

    // Auto-width columns
    sheet.columns.forEach((column) => {
      column.width = 15;
    });

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  async exportToPdf(companyId: string, filters: { startDate?: Date; endDate?: Date; userId?: string }) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
    });

    const where: any = { companyId };

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

    // Header
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

    // Group by worker
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

      // Worker header
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

      // Worker totals
      doc.rect(40, yPos, 712, 20).fill('#d4d4d4').stroke('#999999');
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#000000');
      doc.text('TOTAL', 45, yPos + 6);
      doc.text(workerTotalRegular.toFixed(1), 355, yPos + 6, { width: 35 });
      doc.text(workerTotalOT.toFixed(1), 390, yPos + 6, { width: 35 });
      doc.text(workerTotalDT.toFixed(1), 425, yPos + 6, { width: 35 });
      doc.text((workerTotalRegular + workerTotalOT + workerTotalDT).toFixed(1), 460, yPos + 6, { width: 40 });
      doc.text(`$${workerTotalPay.toFixed(2)}`, 545, yPos + 6, { width: 55 });
      yPos += 28;

      // Signature lines
      if (yPos < pageHeight - marginBottom - 40) {
        doc.font('Helvetica').fontSize(8).fillColor('#666666');
        doc.text('Worker Signature: _______________________________', 45, yPos);
        doc.text('Date: ____________', 300, yPos);
        doc.text('Manager: _______________________________', 450, yPos);
        yPos += 25;
      }
    }

    // Grand totals
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
}
