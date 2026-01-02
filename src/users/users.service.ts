import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AwsService } from '../aws/aws.service';
import { AuditService } from '../audit/audit.service';
import { CreateUserDto, UpdateUserDto, SetWorkerJobRateDto } from './dto';
import { Decimal } from '@prisma/client/runtime/library';

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private awsService: AwsService,
    private auditService: AuditService,
  ) {}

  async create(companyId: string, dto: CreateUserDto, performedBy?: string) {
    // Format phone number
    let formattedPhone = dto.phone.trim();
    if (!formattedPhone.startsWith('+')) {
      formattedPhone = '+1' + formattedPhone.replace(/\D/g, '');
    }

    const existing = await this.prisma.user.findFirst({
      where: { companyId, phone: formattedPhone },
    });

    if (existing) {
      throw new ForbiddenException('User with this phone number already exists');
    }

    let referencePhotoUrl: string | undefined = undefined;
    if (dto.referencePhoto) {
      try {
        const tempId = `new-${Date.now()}`;
        referencePhotoUrl = await this.awsService.uploadPhoto(
          dto.referencePhoto,
          tempId,
          'clock-in',
        );
        console.log('📸 Reference photo uploaded for new user');
      } catch (err) {
        console.error('Failed to upload reference photo:', err);
      }
    }

    const user = await this.prisma.user.create({
      data: {
        companyId,
        name: dto.name,
        phone: formattedPhone,
        email: dto.email,
        role: dto.role || 'WORKER',
        referencePhotoUrl: referencePhotoUrl || undefined,
        hourlyRate: dto.hourlyRate ? new Decimal(dto.hourlyRate) : null,
      },
      include: { company: true },
    });

    // Audit log
    await this.auditService.log({
      companyId,
      userId: performedBy,
      action: 'USER_CREATED',
      targetType: 'USER',
      targetId: user.id,
      details: { name: user.name, phone: user.phone, role: user.role, hourlyRate: dto.hourlyRate },
    });

    return user;
  }

  async findAll(companyId: string) {
    return this.prisma.user.findMany({
      where: { companyId },
      include: { 
        company: { select: { id: true, name: true } },
        jobRates: {
          include: {
            job: { select: { id: true, name: true } }
          }
        }
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(companyId: string, userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, companyId },
      include: { 
        company: true,
        jobRates: {
          include: {
            job: { select: { id: true, name: true } }
          }
        }
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async update(companyId: string, userId: string, dto: UpdateUserDto, performedBy?: string) {
    const user = await this.findOne(companyId, userId);
    const changes: string[] = [];

    // Handle phone number update
    let formattedPhone: string | undefined = undefined;
    if (dto.phone) {
      formattedPhone = dto.phone.trim();
      if (!formattedPhone.startsWith('+')) {
        formattedPhone = '+1' + formattedPhone.replace(/\D/g, '');
      }

      if (formattedPhone !== user.phone) {
        const existingPhone = await this.prisma.user.findFirst({
          where: {
            companyId,
            phone: formattedPhone,
            id: { not: userId },
          },
        });

        if (existingPhone) {
          throw new ForbiddenException('Another user with this phone number already exists');
        }

        changes.push(`phone: ${user.phone} → ${formattedPhone}`);
        
        await this.auditService.log({
          companyId,
          userId: performedBy,
          action: 'USER_PHONE_CHANGED',
          targetType: 'USER',
          targetId: userId,
          details: { oldPhone: user.phone, newPhone: formattedPhone },
        });
      }
    }

    // Track role changes
    if (dto.role && dto.role !== user.role) {
      changes.push(`role: ${user.role} → ${dto.role}`);
      
      await this.auditService.log({
        companyId,
        userId: performedBy,
        action: 'USER_ROLE_CHANGED',
        targetType: 'USER',
        targetId: userId,
        details: { oldRole: user.role, newRole: dto.role },
      });
    }

    // Track hourly rate changes
    const currentRate = user.hourlyRate ? Number(user.hourlyRate) : null;
    if (dto.hourlyRate !== undefined && dto.hourlyRate !== currentRate) {
      changes.push(`hourlyRate: $${currentRate || 0} → $${dto.hourlyRate}`);
      
      await this.auditService.log({
        companyId,
        userId: performedBy,
        action: 'PAY_RATE_UPDATED',
        targetType: 'USER',
        targetId: userId,
        details: { 
          userName: user.name,
          oldRate: currentRate, 
          newRate: dto.hourlyRate 
        },
      });
    }

    // Track approval status changes
    if (dto.approvalStatus && dto.approvalStatus !== user.approvalStatus) {
      if (dto.approvalStatus === 'APPROVED') {
        await this.auditService.log({
          companyId,
          userId: performedBy,
          action: 'USER_APPROVED',
          targetType: 'USER',
          targetId: userId,
          details: { userName: user.name },
        });
      } else if (dto.approvalStatus === 'REJECTED') {
        await this.auditService.log({
          companyId,
          userId: performedBy,
          action: 'USER_REJECTED',
          targetType: 'USER',
          targetId: userId,
          details: { userName: user.name },
        });
      }
    }

    // Track deactivation
    if (dto.isActive === false && user.isActive === true) {
      await this.auditService.log({
        companyId,
        userId: performedBy,
        action: 'USER_DEACTIVATED',
        targetType: 'USER',
        targetId: userId,
        details: { userName: user.name },
      });
    }

    // Handle reference photo upload
    let referencePhotoUrl: string | undefined = undefined;
    if (dto.referencePhoto) {
      try {
        referencePhotoUrl = await this.awsService.uploadPhoto(
          dto.referencePhoto,
          userId,
          'clock-in',
        );
        console.log('📸 Reference photo updated for user:', userId);
      } catch (err) {
        console.error('Failed to upload reference photo:', err);
      }
    }

    const updateData: any = {
      name: dto.name,
      email: dto.email,
      role: dto.role,
      isActive: dto.isActive,
      approvalStatus: dto.approvalStatus,
    };

    if (formattedPhone) {
      updateData.phone = formattedPhone;
    }

    if (referencePhotoUrl) {
      updateData.referencePhotoUrl = referencePhotoUrl;
    }

    if (dto.hourlyRate !== undefined) {
      updateData.hourlyRate = dto.hourlyRate ? new Decimal(dto.hourlyRate) : null;
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: updateData,
      include: { company: true },
    });

    // General update log if there were other changes
    if (changes.length > 0 || dto.name !== user.name || dto.email !== user.email) {
      await this.auditService.log({
        companyId,
        userId: performedBy,
        action: 'USER_UPDATED',
        targetType: 'USER',
        targetId: userId,
        details: { changes },
      });
    }

    return updatedUser;
  }

  async remove(companyId: string, userId: string, performedBy?: string) {
    const user = await this.findOne(companyId, userId);

    await this.auditService.log({
      companyId,
      userId: performedBy,
      action: 'USER_DEACTIVATED',
      targetType: 'USER',
      targetId: userId,
      details: { userName: user.name },
    });

    return this.prisma.user.update({
      where: { id: userId },
      data: { isActive: false },
    });
  }

  // ============ PAY RATE METHODS ============

  async getWorkerJobRates(companyId: string, userId: string) {
    await this.findOne(companyId, userId); // Verify user exists

    return this.prisma.workerJobRate.findMany({
      where: { companyId, userId },
      include: {
        job: { select: { id: true, name: true, address: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async setWorkerJobRate(companyId: string, userId: string, dto: SetWorkerJobRateDto, performedBy?: string) {
    const user = await this.findOne(companyId, userId);

    // Verify job exists and belongs to company
    const job = await this.prisma.job.findFirst({
      where: { id: dto.jobId, companyId },
    });

    if (!job) {
      throw new NotFoundException('Job not found');
    }

    // Upsert the rate
    const rate = await this.prisma.workerJobRate.upsert({
      where: {
        userId_jobId: { userId, jobId: dto.jobId },
      },
      update: {
        hourlyRate: new Decimal(dto.hourlyRate),
        isPrevailingWage: dto.isPrevailingWage || false,
        notes: dto.notes,
      },
      create: {
        companyId,
        userId,
        jobId: dto.jobId,
        hourlyRate: new Decimal(dto.hourlyRate),
        isPrevailingWage: dto.isPrevailingWage || false,
        notes: dto.notes,
      },
      include: {
        job: { select: { id: true, name: true } },
      },
    });

    await this.auditService.log({
      companyId,
      userId: performedBy,
      action: 'PAY_RATE_UPDATED',
      targetType: 'WORKER_JOB_RATE',
      targetId: rate.id,
      details: {
        userName: user.name,
        jobName: job.name,
        hourlyRate: dto.hourlyRate,
        isPrevailingWage: dto.isPrevailingWage,
      },
    });

    return rate;
  }

  async removeWorkerJobRate(companyId: string, userId: string, jobId: string, performedBy?: string) {
    const user = await this.findOne(companyId, userId);

    const rate = await this.prisma.workerJobRate.findFirst({
      where: { companyId, userId, jobId },
      include: { job: { select: { name: true } } },
    });

    if (!rate) {
      throw new NotFoundException('Job rate not found');
    }

    await this.prisma.workerJobRate.delete({
      where: { id: rate.id },
    });

    await this.auditService.log({
      companyId,
      userId: performedBy,
      action: 'PAY_RATE_UPDATED',
      targetType: 'WORKER_JOB_RATE',
      targetId: rate.id,
      details: {
        userName: user.name,
        jobName: rate.job.name,
        action: 'removed',
      },
    });

    return { success: true };
  }

  // Get effective rate for a worker on a specific job
  async getEffectiveRate(companyId: string, userId: string, jobId?: string): Promise<{ rate: number | null; isPrevailingWage: boolean; source: string }> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, companyId },
      select: { hourlyRate: true },
    });

    if (!user) {
      return { rate: null, isPrevailingWage: false, source: 'none' };
    }

    // If job specified, check for job-specific rate first
    if (jobId) {
      const jobRate = await this.prisma.workerJobRate.findFirst({
        where: { companyId, userId, jobId },
      });

      if (jobRate) {
        return { 
          rate: Number(jobRate.hourlyRate), 
          isPrevailingWage: jobRate.isPrevailingWage,
          source: 'job_specific' 
        };
      }

      // Check job default rate
      const job = await this.prisma.job.findFirst({
        where: { id: jobId, companyId },
        select: { defaultHourlyRate: true, isPrevailingWage: true },
      });

      if (job?.defaultHourlyRate) {
        return { 
          rate: Number(job.defaultHourlyRate), 
          isPrevailingWage: job.isPrevailingWage,
          source: 'job_default' 
        };
      }
    }

    // Fall back to worker default rate
    if (user.hourlyRate) {
      return { 
        rate: Number(user.hourlyRate), 
        isPrevailingWage: false,
        source: 'worker_default' 
      };
    }

    return { rate: null, isPrevailingWage: false, source: 'none' };
  }
}
