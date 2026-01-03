import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JobsService } from '../jobs/jobs.service';
import { AwsService } from '../aws/aws.service';
import { EmailService } from '../email/email.service';
import { AuditService } from '../audit/audit.service';
import { ClockInDto, ClockOutDto, ManualTimeEntryDto } from './dto';
import { Decimal } from '@prisma/client/runtime/library';
import * as ExcelJS from 'exceljs';

interface OvertimeSettings {
  dailyOtThreshold: number;
  dailyDtThreshold: number;
  weeklyOtThreshold: number;
  otMultiplier: number;
  dtMultiplier: number;
}

interface OvertimeBreakdown {
  regularMinutes: number;
  overtimeMinutes: number;
  doubleTimeMinutes: number;
  regularPay: number;
  overtimePay: number;
  doubleTimePay: number;
  totalPay: number;
}

@Injectable()
export class TimeEntriesService {
  constructor(
    private prisma: PrismaService,
    private jobsService: JobsService,
    private awsService: AwsService,
    private emailService: EmailService,
    private auditService: AuditService,
  ) {}

  private async getOvertimeSettings(companyId: string): Promise<OvertimeSettings> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { overtimeSettings: true },
    });

    const defaults: OvertimeSettings = {
      dailyOtThreshold: 480,
      dailyDtThreshold: 720,
      weeklyOtThreshold: 2400,
      otMultiplier: 1.5,
      dtMultiplier: 2.0,
    };

    if (!company?.overtimeSettings) return defaults;

    const settings = company.overtimeSettings as any;
    return {
      dailyOtThreshold: settings.dailyOtThreshold ?? defaults.dailyOtThreshold,
      dailyDtThreshold: settings.dailyDtThreshold ?? defaults.dailyDtThreshold,
      weeklyOtThreshold: settings.weeklyOtThreshold ?? defaults.weeklyOtThreshold,
      otMultiplier: settings.otMultiplier ?? defaults.otMultiplier,
      dtMultiplier: settings.dtMultiplier ?? defaults.dtMultiplier,
    };
  }

  private async getWeeklyMinutesWorked(userId: string, companyId: string, beforeDate: Date): Promise<number> {
    const startOfWeek = new Date(beforeDate);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

    const entries = await this.prisma.timeEntry.findMany({
      where: {
        userId,
        companyId,
        clockOutTime: { not: null },
        clockInTime: {
          gte: startOfWeek,
          lt: beforeDate,
        },
      },
      select: { durationMinutes: true, breakMinutes: true },
    });

    return entries.reduce((sum, e) => sum + ((e.durationMinutes || 0) - (e.breakMinutes || 0)), 0);
  }

  private calculateOvertimeBreakdown(
    durationMinutes: number,
    hourlyRate: number,
    settings: OvertimeSettings,
    weeklyMinutesBefore: number,
  ): OvertimeBreakdown {
    let regularMinutes = 0;
    let overtimeMinutes = 0;
    let doubleTimeMinutes = 0;

    if (durationMinutes <= settings.dailyOtThreshold) {
      regularMinutes = durationMinutes;
    } else if (durationMinutes <= settings.dailyDtThreshold) {
      regularMinutes = settings.dailyOtThreshold;
      overtimeMinutes = durationMinutes - settings.dailyOtThreshold;
    } else {
      regularMinutes = settings.dailyOtThreshold;
      overtimeMinutes = settings.dailyDtThreshold - settings.dailyOtThreshold;
      doubleTimeMinutes = durationMinutes - settings.dailyDtThreshold;
    }

    const totalWeeklyAfter = weeklyMinutesBefore + regularMinutes;
    if (totalWeeklyAfter > settings.weeklyOtThreshold) {
      if (weeklyMinutesBefore < settings.weeklyOtThreshold) {
        const regularBeforeWeeklyOt = settings.weeklyOtThreshold - weeklyMinutesBefore;
        const excessRegular = regularMinutes - regularBeforeWeeklyOt;
        regularMinutes = regularBeforeWeeklyOt;
        overtimeMinutes += excessRegular;
      } else {
        overtimeMinutes += regularMinutes;
        regularMinutes = 0;
      }
    }

    const regularPay = (regularMinutes / 60) * hourlyRate;
    const overtimePay = (overtimeMinutes / 60) * hourlyRate * settings.otMultiplier;
    const doubleTimePay = (doubleTimeMinutes / 60) * hourlyRate * settings.dtMultiplier;

    return {
      regularMinutes,
      overtimeMinutes,
      doubleTimeMinutes,
      regularPay: Math.round(regularPay * 100) / 100,
      overtimePay: Math.round(overtimePay * 100) / 100,
      doubleTimePay: Math.round(doubleTimePay * 100) / 100,
      totalPay: Math.round((regularPay + overtimePay + doubleTimePay) * 100) / 100,
    };
  }

  private async getEffectiveRate(companyId: string, userId: string, jobId?: string): Promise<{ rate: number | null; isPrevailingWage: boolean }> {
    if (jobId) {
      const jobRate = await this.prisma.workerJobRate.findFirst({
        where: { companyId, userId, jobId },
      });

      if (jobRate) {
        return { rate: Number(jobRate.hourlyRate), isPrevailingWage: jobRate.isPrevailingWage };
      }

      const job = await this.prisma.job.findFirst({
        where: { id: jobId, companyId },
        select: { defaultHourlyRate: true, isPrevailingWage: true },
      });

      if (job?.defaultHourlyRate) {
        return { rate: Number(job.defaultHourlyRate), isPrevailingWage: job.isPrevailingWage };
      }
    }

    const user = await this.prisma.user.findFirst({
      where: { id: userId, companyId },
      select: { hourlyRate: true },
    });

    if (user?.hourlyRate) {
      return { rate: Number(user.hourlyRate), isPrevailingWage: false };
    }

    return { rate: null, isPrevailingWage: false };
  }

  // ============ MANUAL ENTRY ============

  async createManualEntry(companyId: string, dto: ManualTimeEntryDto, createdBy: string) {
    // Validate user exists
    const user = await this.prisma.user.findFirst({
      where: { id: dto.userId, companyId },
    });
    if (!user) throw new NotFoundException('Worker not found');

    // Validate job exists
    const job = await this.prisma.job.findFirst({
      where: { id: dto.jobId, companyId },
    });
    if (!job) throw new NotFoundException('Job not found');

    // Parse date and times
    const clockInTime = new Date(`${dto.date}T${dto.clockIn}:00`);
    const clockOutTime = new Date(`${dto.date}T${dto.clockOut}:00`);

    // Handle overnight shifts
    if (clockOutTime <= clockInTime) {
      clockOutTime.setDate(clockOutTime.getDate() + 1);
    }

    const totalMinutes = Math.round((clockOutTime.getTime() - clockInTime.getTime()) / 1000 / 60);
    const breakMinutes = dto.breakMinutes || 0;
    const durationMinutes = totalMinutes - breakMinutes;

    // Get rate and calculate overtime
    const { rate, isPrevailingWage } = await this.getEffectiveRate(companyId, dto.userId, dto.jobId);
    const otSettings = await this.getOvertimeSettings(companyId);
    const weeklyMinutesBefore = await this.getWeeklyMinutesWorked(dto.userId, companyId, clockInTime);

    const breakdown = rate
      ? this.calculateOvertimeBreakdown(durationMinutes, rate, otSettings, weeklyMinutesBefore)
      : {
          regularMinutes: durationMinutes,
          overtimeMinutes: 0,
          doubleTimeMinutes: 0,
          regularPay: 0,
          overtimePay: 0,
          doubleTimePay: 0,
          totalPay: 0,
        };

    const entry = await this.prisma.timeEntry.create({
      data: {
        companyId,
        userId: dto.userId,
        jobId: dto.jobId,
        clockInTime,
        clockOutTime,
        durationMinutes,
        breakMinutes,
        notes: dto.notes ? `[Manual Entry] ${dto.notes}` : '[Manual Entry]',
        approvalStatus: 'APPROVED', // Manual entries are pre-approved
        hourlyRate: rate ? new Decimal(rate) : null,
        isPrevailingWage,
        regularMinutes: breakdown.regularMinutes,
        overtimeMinutes: breakdown.overtimeMinutes,
        doubleTimeMinutes: breakdown.doubleTimeMinutes,
        regularPay: new Decimal(breakdown.regularPay),
        overtimePay: new Decimal(breakdown.overtimePay),
        doubleTimePay: new Decimal(breakdown.doubleTimePay),
        laborCost: new Decimal(breakdown.totalPay),
      },
      include: {
        user: { select: { id: true, name: true, phone: true } },
        job: true,
      },
    });

    await this.auditService.log({
      companyId,
      userId: createdBy,
      action: 'TIME_ENTRY_APPROVED',
      targetType: 'TIME_ENTRY',
      targetId: entry.id,
      details: {
        type: 'manual_entry',
        workerName: user.name,
        jobName: job.name,
        durationMinutes,
        laborCost: breakdown.totalPay,
      },
    });

    return entry;
  }

  // ============ EXPORT TO EXCEL ============

  async exportToExcel(companyId: string, startDate?: Date, endDate?: Date): Promise<Buffer> {
    const entries = await this.getTimeEntries(companyId, { startDate, endDate });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Punchd';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Timesheet');

    // Define columns
    sheet.columns = [
      { header: 'Worker', key: 'worker', width: 20 },
      { header: 'Job Site', key: 'job', width: 25 },
      { header: 'Date', key: 'date', width: 12 },
      { header: 'Clock In', key: 'clockIn', width: 10 },
      { header: 'Clock Out', key: 'clockOut', width: 10 },
      { header: 'Break (min)', key: 'break', width: 12 },
      { header: 'Regular Hrs', key: 'regularHrs', width: 12 },
      { header: 'OT Hrs (1.5x)', key: 'otHrs', width: 12 },
      { header: 'DT Hrs (2x)', key: 'dtHrs', width: 12 },
      { header: 'Total Hrs', key: 'totalHrs', width: 10 },
      { header: 'Hourly Rate', key: 'rate', width: 12 },
      { header: 'Regular Pay', key: 'regularPay', width: 12 },
      { header: 'OT Pay', key: 'otPay', width: 12 },
      { header: 'DT Pay', key: 'dtPay', width: 12 },
      { header: 'Total Pay', key: 'totalPay', width: 12 },
      { header: 'Status', key: 'status', width: 12 },
    ];

    // Style header row
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4F46E5' },
    };
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

    // Add data rows
    entries.forEach((entry: any) => {
      const regularHrs = (entry.regularMinutes || 0) / 60;
      const otHrs = (entry.overtimeMinutes || 0) / 60;
      const dtHrs = (entry.doubleTimeMinutes || 0) / 60;
      const totalHrs = (entry.durationMinutes || 0) / 60;

      sheet.addRow({
        worker: entry.user?.name || 'Unknown',
        job: entry.job?.name || 'Unassigned',
        date: entry.clockInTime ? new Date(entry.clockInTime).toLocaleDateString() : '',
        clockIn: entry.clockInTime ? new Date(entry.clockInTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '',
        clockOut: entry.clockOutTime ? new Date(entry.clockOutTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : 'Active',
        break: entry.breakMinutes || 0,
        regularHrs: regularHrs.toFixed(2),
        otHrs: otHrs.toFixed(2),
        dtHrs: dtHrs.toFixed(2),
        totalHrs: totalHrs.toFixed(2),
        rate: entry.hourlyRate ? `$${Number(entry.hourlyRate).toFixed(2)}` : '-',
        regularPay: entry.regularPay ? `$${Number(entry.regularPay).toFixed(2)}` : '-',
        otPay: entry.overtimePay ? `$${Number(entry.overtimePay).toFixed(2)}` : '-',
        dtPay: entry.doubleTimePay ? `$${Number(entry.doubleTimePay).toFixed(2)}` : '-',
        totalPay: entry.laborCost ? `$${Number(entry.laborCost).toFixed(2)}` : '-',
        status: entry.approvalStatus,
      });
    });

    // Add totals row
    const totalRegularHrs = entries.reduce((sum: number, e: any) => sum + ((e.regularMinutes || 0) / 60), 0);
    const totalOtHrs = entries.reduce((sum: number, e: any) => sum + ((e.overtimeMinutes || 0) / 60), 0);
    const totalDtHrs = entries.reduce((sum: number, e: any) => sum + ((e.doubleTimeMinutes || 0) / 60), 0);
    const totalHrs = entries.reduce((sum: number, e: any) => sum + ((e.durationMinutes || 0) / 60), 0);
    const totalRegularPay = entries.reduce((sum: number, e: any) => sum + (e.regularPay ? Number(e.regularPay) : 0), 0);
    const totalOtPay = entries.reduce((sum: number, e: any) => sum + (e.overtimePay ? Number(e.overtimePay) : 0), 0);
    const totalDtPay = entries.reduce((sum: number, e: any) => sum + (e.doubleTimePay ? Number(e.doubleTimePay) : 0), 0);
    const totalPay = entries.reduce((sum: number, e: any) => sum + (e.laborCost ? Number(e.laborCost) : 0), 0);

    const totalsRow = sheet.addRow({
      worker: 'TOTALS',
      job: '',
      date: '',
      clockIn: '',
      clockOut: '',
      break: '',
      regularHrs: totalRegularHrs.toFixed(2),
      otHrs: totalOtHrs.toFixed(2),
      dtHrs: totalDtHrs.toFixed(2),
      totalHrs: totalHrs.toFixed(2),
      rate: '',
      regularPay: `$${totalRegularPay.toFixed(2)}`,
      otPay: `$${totalOtPay.toFixed(2)}`,
      dtPay: `$${totalDtPay.toFixed(2)}`,
      totalPay: `$${totalPay.toFixed(2)}`,
      status: '',
    });
    totalsRow.font = { bold: true };
    totalsRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF3F4F6' },
    };

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  // ============ CLOCK IN/OUT ============

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

    const { rate, isPrevailingWage } = await this.getEffectiveRate(companyId, userId, jobId || undefined);

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
        hourlyRate: rate ? new Decimal(rate) : null,
        isPrevailingWage,
      },
      include: {
        job: true,
        user: { select: { id: true, name: true, phone: true, hourlyRate: true } },
      },
    });

    // Face verification
    if (user?.referencePhotoUrl && photoUrl !== 'placeholder.jpg') {
      try {
        console.log('🔍 Starting face verification...');
        const confidence = await this.awsService.compareFaces(user.referencePhotoUrl, photoUrl);

        const matched = confidence >= 80;
        console.log(`✅ Face verification result: ${confidence}% confidence, matched: ${matched}`);

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
          console.log('⚠️ Face mismatch - BLOCKING clock-in!');
          await this.prisma.timeEntry.delete({ where: { id: timeEntry.id } });

          const admins = await this.prisma.user.findMany({
            where: { companyId, role: { in: ['ADMIN', 'OWNER'] }, email: { not: null } },
            select: { email: true },
          });

          for (const admin of admins) {
            if (admin.email) {
              try {
                await this.emailService.sendBuddyPunchAlert(admin.email, user.name, user.phone, jobName, confidence, photoUrl);
              } catch (emailErr) {
                console.error('Failed to send buddy punch alert:', emailErr);
              }
            }
          }

          throw new ForbiddenException(`Face verification failed. Confidence: ${confidence.toFixed(1)}%. Please try again or contact your supervisor.`);
        }
      } catch (err) {
        if (err instanceof ForbiddenException) throw err;
        console.error('❌ Face verification error:', err);
        const updatedFlagReasons = timeEntry.flagReason ? `${timeEntry.flagReason}, FACE_VERIFICATION_ERROR` : 'FACE_VERIFICATION_ERROR';
        await this.prisma.timeEntry.update({
          where: { id: timeEntry.id },
          data: { isFlagged: true, flagReason: updatedFlagReasons },
        });
      }
    } else if (!user?.referencePhotoUrl && photoUrl !== 'placeholder.jpg') {
      console.log('📸 No reference photo found. Setting first clock-in photo as reference...');
      await this.prisma.user.update({
        where: { id: userId },
        data: { referencePhotoUrl: photoUrl },
      });
      console.log('✅ Reference photo set for user:', userId);
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
    const durationMinutes = totalMinutes - (activeEntry.breakMinutes || 0);

    let photoUrl = 'placeholder.jpg';
    if (dto.photoUrl && dto.photoUrl !== 'placeholder.jpg') {
      try {
        photoUrl = await this.awsService.uploadPhoto(dto.photoUrl, userId, 'clock-out');
      } catch (err) {
        console.error('Failed to upload photo to S3:', err);
      }
    }

    const hourlyRate = activeEntry.hourlyRate ? Number(activeEntry.hourlyRate) : 0;
    const otSettings = await this.getOvertimeSettings(companyId);
    const weeklyMinutesBefore = await this.getWeeklyMinutesWorked(userId, companyId, clockInTime);

    const breakdown = hourlyRate > 0
      ? this.calculateOvertimeBreakdown(durationMinutes, hourlyRate, otSettings, weeklyMinutesBefore)
      : {
          regularMinutes: durationMinutes,
          overtimeMinutes: 0,
          doubleTimeMinutes: 0,
          regularPay: 0,
          overtimePay: 0,
          doubleTimePay: 0,
          totalPay: 0,
        };

    return this.prisma.timeEntry.update({
      where: { id: activeEntry.id },
      data: {
        clockOutTime,
        clockOutLocation: `${dto.latitude},${dto.longitude}`,
        clockOutPhotoUrl: photoUrl,
        durationMinutes,
        regularMinutes: breakdown.regularMinutes,
        overtimeMinutes: breakdown.overtimeMinutes,
        doubleTimeMinutes: breakdown.doubleTimeMinutes,
        regularPay: new Decimal(breakdown.regularPay),
        overtimePay: new Decimal(breakdown.overtimePay),
        doubleTimePay: new Decimal(breakdown.doubleTimePay),
        laborCost: new Decimal(breakdown.totalPay),
      },
      include: {
        job: true,
        user: { select: { id: true, name: true, phone: true, hourlyRate: true } },
      },
    });
  }

  async startBreak(userId: string) {
    const activeEntry = await this.prisma.timeEntry.findFirst({
      where: { userId, clockOutTime: null },
    });

    if (!activeEntry) throw new BadRequestException('You must be clocked in to start a break.');
    if (activeEntry.isOnBreak) throw new BadRequestException('You are already on a break.');

    return this.prisma.timeEntry.update({
      where: { id: activeEntry.id },
      data: { isOnBreak: true, breakStartTime: new Date() },
      include: { job: true, user: { select: { id: true, name: true, phone: true } } },
    });
  }

  async endBreak(userId: string) {
    const activeEntry = await this.prisma.timeEntry.findFirst({
      where: { userId, clockOutTime: null },
    });

    if (!activeEntry) throw new BadRequestException('You must be clocked in to end a break.');
    if (!activeEntry.isOnBreak) throw new BadRequestException('You are not currently on a break.');

    const breakStartTime = new Date(activeEntry.breakStartTime!);
    const breakEndTime = new Date();
    const breakDuration = Math.round((breakEndTime.getTime() - breakStartTime.getTime()) / 1000 / 60);
    const totalBreakMinutes = (activeEntry.breakMinutes || 0) + breakDuration;

    return this.prisma.timeEntry.update({
      where: { id: activeEntry.id },
      data: { isOnBreak: false, breakEndTime, breakMinutes: totalBreakMinutes },
      include: { job: true, user: { select: { id: true, name: true, phone: true } } },
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
      if (filters.endDate) where.clockInTime.lte = filters.endDate;
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

  // ============ APPROVAL WORKFLOW ============

  async getPendingApprovals(companyId: string) {
    return this.prisma.timeEntry.findMany({
      where: { companyId, approvalStatus: 'PENDING', clockOutTime: { not: null } },
      include: { user: { select: { id: true, name: true, phone: true, hourlyRate: true } }, job: true },
      orderBy: { clockInTime: 'desc' },
    });
  }

  async getApprovalStats(companyId: string) {
    const [pending, approved, rejected] = await Promise.all([
      this.prisma.timeEntry.count({ where: { companyId, approvalStatus: 'PENDING', clockOutTime: { not: null } } }),
      this.prisma.timeEntry.count({ where: { companyId, approvalStatus: 'APPROVED' } }),
      this.prisma.timeEntry.count({ where: { companyId, approvalStatus: 'REJECTED' } }),
    ]);
    return { pending, approved, rejected };
  }

  async approveEntry(entryId: string, approverId: string, companyId: string) {
    const entry = await this.prisma.timeEntry.findFirst({
      where: { id: entryId, companyId },
      include: { user: { select: { id: true, name: true } } },
    });

    if (!entry) throw new NotFoundException('Time entry not found');
    if (entry.approvalStatus !== 'PENDING') throw new BadRequestException(`Entry is already ${entry.approvalStatus.toLowerCase()}`);
    if (!entry.clockOutTime) throw new BadRequestException('Cannot approve an entry that is still active');

    const updated = await this.prisma.timeEntry.update({
      where: { id: entryId },
      data: { approvalStatus: 'APPROVED', approvedById: approverId, approvedAt: new Date(), rejectionReason: null },
      include: { user: { select: { id: true, name: true, phone: true, hourlyRate: true } }, job: true, approvedBy: { select: { id: true, name: true } } },
    });

    await this.auditService.log({
      companyId,
      userId: approverId,
      action: 'TIME_ENTRY_APPROVED',
      targetType: 'TIME_ENTRY',
      targetId: entryId,
      details: { workerName: entry.user?.name, workerId: entry.userId, durationMinutes: entry.durationMinutes, laborCost: entry.laborCost ? Number(entry.laborCost) : null },
    });

    return updated;
  }

  async rejectEntry(entryId: string, approverId: string, companyId: string, reason?: string) {
    const entry = await this.prisma.timeEntry.findFirst({
      where: { id: entryId, companyId },
      include: { user: { select: { id: true, name: true } } },
    });

    if (!entry) throw new NotFoundException('Time entry not found');
    if (entry.approvalStatus !== 'PENDING') throw new BadRequestException(`Entry is already ${entry.approvalStatus.toLowerCase()}`);

    const updated = await this.prisma.timeEntry.update({
      where: { id: entryId },
      data: { approvalStatus: 'REJECTED', approvedById: approverId, approvedAt: new Date(), rejectionReason: reason || 'No reason provided' },
      include: { user: { select: { id: true, name: true, phone: true } }, job: true, approvedBy: { select: { id: true, name: true } } },
    });

    await this.auditService.log({
      companyId,
      userId: approverId,
      action: 'TIME_ENTRY_REJECTED',
      targetType: 'TIME_ENTRY',
      targetId: entryId,
      details: { workerName: entry.user?.name, workerId: entry.userId, durationMinutes: entry.durationMinutes, rejectionReason: reason },
    });

    return updated;
  }

  async bulkApprove(entryIds: string[], approverId: string, companyId: string) {
    const results = { approved: 0, failed: 0, errors: [] as string[] };
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
    const results = { rejected: 0, failed: 0, errors: [] as string[] };
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

  // ============ OVERTIME ANALYTICS ============

  async getOvertimeSummary(companyId: string, startDate?: Date, endDate?: Date) {
    const where: any = { companyId, clockOutTime: { not: null } };
    if (startDate || endDate) {
      where.clockInTime = {};
      if (startDate) where.clockInTime.gte = startDate;
      if (endDate) where.clockInTime.lte = endDate;
    }

    const entries = await this.prisma.timeEntry.findMany({
      where,
      include: { user: { select: { id: true, name: true } }, job: { select: { id: true, name: true } } },
    });

    const totals = {
      regularMinutes: 0, overtimeMinutes: 0, doubleTimeMinutes: 0,
      regularPay: 0, overtimePay: 0, doubleTimePay: 0, totalPay: 0,
    };

    entries.forEach(e => {
      totals.regularMinutes += e.regularMinutes || 0;
      totals.overtimeMinutes += e.overtimeMinutes || 0;
      totals.doubleTimeMinutes += e.doubleTimeMinutes || 0;
      totals.regularPay += e.regularPay ? Number(e.regularPay) : 0;
      totals.overtimePay += e.overtimePay ? Number(e.overtimePay) : 0;
      totals.doubleTimePay += e.doubleTimePay ? Number(e.doubleTimePay) : 0;
      totals.totalPay += e.laborCost ? Number(e.laborCost) : 0;
    });

    const byWorker = entries.reduce((acc, e) => {
      const workerId = e.userId;
      if (!acc[workerId]) {
        acc[workerId] = { id: workerId, name: e.user?.name || 'Unknown', regularMinutes: 0, overtimeMinutes: 0, doubleTimeMinutes: 0, totalPay: 0 };
      }
      acc[workerId].regularMinutes += e.regularMinutes || 0;
      acc[workerId].overtimeMinutes += e.overtimeMinutes || 0;
      acc[workerId].doubleTimeMinutes += e.doubleTimeMinutes || 0;
      acc[workerId].totalPay += e.laborCost ? Number(e.laborCost) : 0;
      return acc;
    }, {} as Record<string, any>);

    return {
      totals: {
        regularHours: Math.round(totals.regularMinutes / 60 * 100) / 100,
        overtimeHours: Math.round(totals.overtimeMinutes / 60 * 100) / 100,
        doubleTimeHours: Math.round(totals.doubleTimeMinutes / 60 * 100) / 100,
        regularPay: Math.round(totals.regularPay * 100) / 100,
        overtimePay: Math.round(totals.overtimePay * 100) / 100,
        doubleTimePay: Math.round(totals.doubleTimePay * 100) / 100,
        totalPay: Math.round(totals.totalPay * 100) / 100,
      },
      byWorker: Object.values(byWorker),
      entryCount: entries.length,
    };
  }
}
