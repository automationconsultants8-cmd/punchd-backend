import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JobsService } from '../jobs/jobs.service';
import { AwsService } from '../aws/aws.service';
import { EmailService } from '../email/email.service';
import { ClockInDto, ClockOutDto } from './dto';

@Injectable()
export class TimeEntriesService {
  constructor(
    private prisma: PrismaService,
    private jobsService: JobsService,
    private awsService: AwsService,
    private emailService: EmailService,
  ) {}

  async clockIn(userId: string, companyId: string, dto: ClockInDto) {
    const activeEntry = await this.prisma.timeEntry.findFirst({
      where: { userId, companyId, clockOutTime: null },
    });

    if (activeEntry) {
      throw new BadRequestException('You are already clocked in. Please clock out first.');
    }

    // Get user with reference photo
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    // Get job info for alert
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

    // Upload photo to S3
    let photoUrl = 'placeholder.jpg';
    if (dto.photoUrl && dto.photoUrl !== 'placeholder.jpg') {
      try {
        photoUrl = await this.awsService.uploadPhoto(dto.photoUrl, userId, 'clock-in');
      } catch (err) {
        console.error('Failed to upload photo to S3:', err);
        flagReasons.push('PHOTO_UPLOAD_FAILED');
      }
    }

    // Create the time entry first
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
      },
      include: {
        job: true,
        user: { select: { id: true, name: true, phone: true } },
      },
    });

    // Face verification (if user has reference photo)
    if (user?.referencePhotoUrl && photoUrl !== 'placeholder.jpg') {
      try {
        console.log('🔍 Starting face verification...');
        console.log('Reference photo:', user.referencePhotoUrl);
        console.log('Clock-in photo:', photoUrl);

        const confidence = await this.awsService.compareFaces(
          user.referencePhotoUrl,
          photoUrl,
        );

        const matched = confidence >= 80; // 80% threshold

        console.log(`✅ Face verification result: ${confidence}% confidence, matched: ${matched}`);

        // Log the verification
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

        // BLOCK clock-in if face doesn't match
        if (!matched) {
          console.log('⚠️ Face mismatch - BLOCKING clock-in!');

          // Delete the time entry we just created
          await this.prisma.timeEntry.delete({
            where: { id: timeEntry.id },
          });

          // Get admin emails to notify
          const admins = await this.prisma.user.findMany({
            where: {
              companyId,
              role: { in: ['ADMIN', 'OWNER'] },
              email: { not: null },
            },
            select: { email: true },
          });

          // Send buddy punch alert to all admins
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
        // If it's our ForbiddenException, rethrow it
        if (err instanceof ForbiddenException) {
          throw err;
        }

        console.error('❌ Face verification error:', err);
        // For other errors, flag the entry but allow clock-in
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
      // No reference photo - set this as the reference (first clock-in becomes reference)
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
}