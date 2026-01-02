import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JobsService } from '../jobs/jobs.service';
import { AwsService } from '../aws/aws.service';
import { EmailService } from '../email/email.service';
import { AuditService } from '../audit/audit.service';
import { ClockInDto, ClockOutDto } from './dto';

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
        console.log('🔍 Starting face verification...');
        const confidence = await this.awsService.compareFaces(
          user.referencePhotoUrl,
          photoUrl,
        );

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
        console.error('❌ Face verification error:', err);
        const updatedFlagReasons = timeEntry.flagReason
          ? `${timeEntry.flagReason}, FACE_VERIFICATION_ERROR`
          : 'FACE_VERIFICATION_ERROR';

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

    return this.prisma.timeEntry.update({
      where: { id: activeEntry.id },
      data: {
        clockOutTime,
        clockOutLocation: `${dto.latitude},${dto.longitude}`,
        clockOutPhotoUrl: photoUrl,
        durationMinutes,
      },
      include: {
        job: true,
        user: { select: { id: true, name: true, phone: true } },
      },
    });
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
      data: { isOnBreak: true, breakStartTime: new Date() },
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
      if (filters.endDate) where.clockInTime.lte = filters.endDate;
    }

    return this.prisma.timeEntry.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, phone: true } },
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
}
