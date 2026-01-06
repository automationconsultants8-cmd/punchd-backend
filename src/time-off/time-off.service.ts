import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TimeOffType, TimeOffStatus } from '@prisma/client';

@Injectable()
export class TimeOffService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private notificationsService: NotificationsService,
  ) {}

  async create(data: {
    companyId: string;
    requesterId: string;
    timeOffType: TimeOffType;
    startDate: Date;
    endDate: Date;
    reason?: string;
  }) {
    // Validate dates
    if (data.startDate > data.endDate) {
      throw new BadRequestException('Start date must be before end date');
    }

    // Check for overlapping requests
    const overlapping = await this.prisma.timeOffRequest.findFirst({
      where: {
        requesterId: data.requesterId,
        status: { in: ['PENDING', 'APPROVED'] },
        OR: [
          {
            startDate: { lte: data.endDate },
            endDate: { gte: data.startDate },
          },
        ],
      },
    });

    if (overlapping) {
      throw new BadRequestException('You already have a time off request for these dates');
    }

    const request = await this.prisma.timeOffRequest.create({
      data: {
        companyId: data.companyId,
        requesterId: data.requesterId,
        timeOffType: data.timeOffType,
        startDate: data.startDate,
        endDate: data.endDate,
        reason: data.reason,
        status: 'PENDING',
      },
      include: {
        requester: true,
      },
    });

    await this.auditService.log({
      companyId: data.companyId,
      userId: data.requesterId,
      action: 'TIME_OFF_REQUEST_CREATED',
      targetType: 'TimeOffRequest',
      targetId: request.id,
      details: {
        timeOffType: data.timeOffType,
        startDate: data.startDate,
        endDate: data.endDate,
      },
    });

    // Notify admins of new request
    const requester = await this.prisma.user.findUnique({
      where: { id: data.requesterId },
      select: { name: true },
    });
    await this.notificationsService.notifyAdminsOfRequest(
      data.companyId,
      'time_off',
      requester?.name || 'A worker',
    );

    return request;
  }

  async findAll(companyId: string, filters?: {
    status?: TimeOffStatus;
    requesterId?: string;
    timeOffType?: TimeOffType;
    startDate?: Date;
    endDate?: Date;
  }) {
    const where: any = { companyId };

    if (filters?.status) where.status = filters.status;
    if (filters?.requesterId) where.requesterId = filters.requesterId;
    if (filters?.timeOffType) where.timeOffType = filters.timeOffType;
    
    if (filters?.startDate || filters?.endDate) {
      where.OR = [];
      if (filters.startDate) {
        where.OR.push({ endDate: { gte: filters.startDate } });
      }
      if (filters.endDate) {
        where.OR.push({ startDate: { lte: filters.endDate } });
      }
    }

    return this.prisma.timeOffRequest.findMany({
      where,
      include: {
        requester: true,
        reviewedBy: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findPending(companyId: string) {
    return this.findAll(companyId, { status: 'PENDING' });
  }

  async findOne(id: string) {
    const request = await this.prisma.timeOffRequest.findUnique({
      where: { id },
      include: {
        requester: true,
        reviewedBy: true,
      },
    });

    if (!request) {
      throw new NotFoundException('Time off request not found');
    }

    return request;
  }

  async findByUser(userId: string) {
    return this.prisma.timeOffRequest.findMany({
      where: { requesterId: userId },
      include: {
        reviewedBy: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async approve(id: string, reviewerId: string, reviewerNotes?: string) {
    const request = await this.findOne(id);

    if (request.status !== 'PENDING') {
      throw new BadRequestException('Request has already been processed');
    }

    const updated = await this.prisma.timeOffRequest.update({
      where: { id },
      data: {
        status: 'APPROVED',
        reviewedById: reviewerId,
        reviewedAt: new Date(),
        reviewerNotes,
      },
      include: {
        requester: true,
        reviewedBy: true,
      },
    });

    await this.auditService.log({
      companyId: request.companyId,
      userId: reviewerId,
      action: 'TIME_OFF_REQUEST_APPROVED',
      targetType: 'TimeOffRequest',
      targetId: id,
      details: {
        requesterId: request.requesterId,
        reviewerNotes,
      },
    });

    // Notify requester
    await this.notificationsService.notifyTimeOffApproved(
      request.requesterId,
      updated.startDate.toISOString().split('T')[0],
      updated.endDate.toISOString().split('T')[0],
    );

    return updated;
  }

  async decline(id: string, reviewerId: string, reviewerNotes?: string) {
    const request = await this.findOne(id);

    if (request.status !== 'PENDING') {
      throw new BadRequestException('Request has already been processed');
    }

    const updated = await this.prisma.timeOffRequest.update({
      where: { id },
      data: {
        status: 'DECLINED',
        reviewedById: reviewerId,
        reviewedAt: new Date(),
        reviewerNotes,
      },
      include: {
        requester: true,
        reviewedBy: true,
      },
    });

    await this.auditService.log({
      companyId: request.companyId,
      userId: reviewerId,
      action: 'TIME_OFF_REQUEST_DECLINED',
      targetType: 'TimeOffRequest',
      targetId: id,
      details: {
        requesterId: request.requesterId,
        reviewerNotes,
      },
    });

    // Notify requester
    await this.notificationsService.notifyTimeOffDeclined(
      request.requesterId,
      request.startDate.toISOString().split('T')[0],
      reviewerNotes,
    );

    return updated;
  }

  async cancel(id: string, userId: string) {
    const request = await this.findOne(id);

    if (request.requesterId !== userId) {
      throw new ForbiddenException('You can only cancel your own requests');
    }

    if (request.status !== 'PENDING') {
      throw new BadRequestException('Only pending requests can be cancelled');
    }

    const updated = await this.prisma.timeOffRequest.update({
      where: { id },
      data: { status: 'CANCELLED' },
      include: {
        requester: true,
      },
    });

    await this.auditService.log({
      companyId: request.companyId,
      userId,
      action: 'TIME_OFF_REQUEST_CANCELLED',
      targetType: 'TimeOffRequest',
      targetId: id,
    });

    return updated;
  }

  async getStats(companyId: string) {
    const [pending, approved, declined] = await Promise.all([
      this.prisma.timeOffRequest.count({ where: { companyId, status: 'PENDING' } }),
      this.prisma.timeOffRequest.count({ where: { companyId, status: 'APPROVED' } }),
      this.prisma.timeOffRequest.count({ where: { companyId, status: 'DECLINED' } }),
    ]);

    return { pending, approved, declined, total: pending + approved + declined };
  }

  // Get days calculation
  getDays(startDate: Date, endDate: Date): number {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffTime = Math.abs(end.getTime() - start.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    return diffDays;
  }
}
