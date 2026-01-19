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
        role: (dto.role as any) || 'WORKER',
        workerTypes: dto.workerTypes?.length ? (dto.workerTypes as any) : ['HOURLY'],
        referencePhotoUrl: referencePhotoUrl || undefined,
        hourlyRate: dto.hourlyRate ? new Decimal(dto.hourlyRate) : null,
        address: dto.address || null,
        city: dto.city || null,
        state: dto.state || null,
        zip: dto.zip || null,
        lastFourSSN: dto.lastFourSSN || null,
        tradeClassification: dto.tradeClassification || null,
      },
      include: { company: true },
    });

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
            job: { select: { id: true, name: true } },
          },
        },
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
            job: { select: { id: true, name: true } },
          },
        },
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
          newRate: dto.hourlyRate,
        },
      });
    }

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

    const updateData: any = {};

    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.email !== undefined) updateData.email = dto.email;
    if (dto.role !== undefined) updateData.role = dto.role as any;
    if (dto.workerTypes !== undefined) updateData.workerTypes = dto.workerTypes as any;
    if (dto.isActive !== undefined) updateData.isActive = dto.isActive;
    if (dto.approvalStatus !== undefined) updateData.approvalStatus = dto.approvalStatus;
    if (formattedPhone) updateData.phone = formattedPhone;
    if (referencePhotoUrl) updateData.referencePhotoUrl = referencePhotoUrl;
    if (dto.hourlyRate !== undefined) {
      updateData.hourlyRate = dto.hourlyRate ? new Decimal(dto.hourlyRate) : null;
    }

    // WH-347 fields
    if (dto.address !== undefined) updateData.address = dto.address || null;
    if (dto.city !== undefined) updateData.city = dto.city || null;
    if (dto.state !== undefined) updateData.state = dto.state || null;
    if (dto.zip !== undefined) updateData.zip = dto.zip || null;
    if (dto.lastFourSSN !== undefined) updateData.lastFourSSN = dto.lastFourSSN || null;
    if (dto.tradeClassification !== undefined) updateData.tradeClassification = dto.tradeClassification || null;

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: updateData,
      include: { company: true },
    });

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

  async approveWorker(companyId: string, userId: string, performedBy?: string) {
    const user = await this.findOne(companyId, userId);

    if (user.approvalStatus === 'APPROVED') {
      return user;
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: { 
        approvalStatus: 'APPROVED',
        isActive: true,
      },
      include: { company: true },
    });

    await this.auditService.log({
      companyId,
      userId: performedBy,
      action: 'USER_APPROVED',
      targetType: 'USER',
      targetId: userId,
      details: { userName: user.name },
    });

    return updatedUser;
  }

  async declineWorker(companyId: string, userId: string, performedBy?: string) {
    const user = await this.findOne(companyId, userId);

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: { 
        approvalStatus: 'REJECTED',
        isActive: false,
      },
      include: { company: true },
    });

    await this.auditService.log({
      companyId,
      userId: performedBy,
      action: 'USER_REJECTED',
      targetType: 'USER',
      targetId: userId,
      details: { userName: user.name },
    });

    return updatedUser;
  }

  async getWorkerJobRates(companyId: string, userId: string) {
    await this.findOne(companyId, userId);

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

    const job = await this.prisma.job.findFirst({
      where: { id: dto.jobId, companyId },
    });

    if (!job) {
      throw new NotFoundException('Job not found');
    }

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

  async getEffectiveRate(companyId: string, userId: string, jobId?: string): Promise<{ rate: number | null; isPrevailingWage: boolean; source: string }> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, companyId },
      select: { hourlyRate: true },
    });

    if (!user) {
      return { rate: null, isPrevailingWage: false, source: 'none' };
    }

    // 1. Check job-specific rate first
    if (jobId) {
      const jobRate = await this.prisma.workerJobRate.findFirst({
        where: { companyId, userId, jobId },
      });

      if (jobRate) {
        return {
          rate: Number(jobRate.hourlyRate),
          isPrevailingWage: jobRate.isPrevailingWage,
          source: 'job_specific',
        };
      }

      // 2. Check job default rate
      const job = await this.prisma.job.findFirst({
        where: { id: jobId, companyId },
        select: { defaultHourlyRate: true, isPrevailingWage: true },
      });

      if (job?.defaultHourlyRate) {
        return {
          rate: Number(job.defaultHourlyRate),
          isPrevailingWage: job.isPrevailingWage,
          source: 'job_default',
        };
      }
    }

    // 3. Check worker default rate
    if (user.hourlyRate) {
      return {
        rate: Number(user.hourlyRate),
        isPrevailingWage: false,
        source: 'worker_default',
      };
    }

    // 4. Check company default rate (NEW!)
    const company = await this.prisma.company.findFirst({
      where: { id: companyId },
      select: { defaultHourlyRate: true },
    });

    if (company?.defaultHourlyRate) {
      return {
        rate: Number(company.defaultHourlyRate),
        isPrevailingWage: false,
        source: 'company_default',
      };
    }

    return { rate: null, isPrevailingWage: false, source: 'none' };
  }
}
