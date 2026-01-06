import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ShiftRequestType, ShiftRequestStatus } from '@prisma/client';

@Injectable()
export class ShiftRequestsService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private notificationsService: NotificationsService,
  ) {}

  async create(data: {
    companyId: string;
    requesterId: string;
    shiftId: string;
    requestType: ShiftRequestType;
    reason: string;
    swapTargetId?: string;
    swapShiftId?: string;
  }) {
    // Verify shift exists and belongs to requester
    const shift = await this.prisma.shift.findUnique({
      where: { id: data.shiftId },
      include: { job: true },
    });

    if (!shift) {
      throw new NotFoundException('Shift not found');
    }

    if (shift.userId !== data.requesterId) {
      throw new ForbiddenException('You can only request changes to your own shifts');
    }

    // Check for existing pending request
    const existingRequest = await this.prisma.shiftRequest.findFirst({
      where: {
        shiftId: data.shiftId,
        status: 'PENDING',
      },
    });

    if (existingRequest) {
      throw new BadRequestException('There is already a pending request for this shift');
    }

    const request = await this.prisma.shiftRequest.create({
      data: {
        companyId: data.companyId,
        requesterId: data.requesterId,
        shiftId: data.shiftId,
        requestType: data.requestType,
        reason: data.reason,
        swapTargetId: data.swapTargetId,
        swapShiftId: data.swapShiftId,
        status: 'PENDING',
      },
      include: {
        shift: {
          include: { job: true },
        },
        requester: true,
        swapTarget: true,
      },
    });

    await this.auditService.log({
      companyId: data.companyId,
      userId: data.requesterId,
      action: 'SHIFT_REQUEST_CREATED',
      targetType: 'ShiftRequest',
      targetId: request.id,
      details: {
        requestType: data.requestType,
        shiftId: data.shiftId,
      },
    });

    // Notify admins of new request
    const requester = await this.prisma.user.findUnique({
      where: { id: data.requesterId },
      select: { name: true },
    });
    await this.notificationsService.notifyAdminsOfRequest(
      data.companyId,
      'shift',
      requester?.name || 'A worker',
    );

    return request;
  }

  async findAll(companyId: string, filters?: {
    status?: ShiftRequestStatus;
    requesterId?: string;
    requestType?: ShiftRequestType;
  }) {
    const where: any = { companyId };

    if (filters?.status) where.status = filters.status;
    if (filters?.requesterId) where.requesterId = filters.requesterId;
    if (filters?.requestType) where.requestType = filters.requestType;

    return this.prisma.shiftRequest.findMany({
      where,
      include: {
        shift: {
          include: { job: true },
        },
        requester: true,
        swapTarget: true,
        reviewedBy: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findPending(companyId: string) {
    return this.findAll(companyId, { status: 'PENDING' });
  }

  async findOne(id: string) {
    const request = await this.prisma.shiftRequest.findUnique({
      where: { id },
      include: {
        shift: {
          include: { job: true },
        },
        requester: true,
        swapTarget: true,
        reviewedBy: true,
      },
    });

    if (!request) {
      throw new NotFoundException('Shift request not found');
    }

    return request;
  }

  async findByUser(userId: string) {
    return this.prisma.shiftRequest.findMany({
      where: { requesterId: userId },
      include: {
        shift: {
          include: { job: true },
        },
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

    const updated = await this.prisma.shiftRequest.update({
      where: { id },
      data: {
        status: 'APPROVED',
        reviewedById: reviewerId,
        reviewedAt: new Date(),
        reviewerNotes,
      },
      include: {
        shift: {
          include: { job: true },
        },
        requester: true,
        reviewedBy: true,
      },
    });

    // If DROP request, cancel the shift
    if (request.requestType === 'DROP') {
      await this.prisma.shift.update({
        where: { id: request.shiftId },
        data: { status: 'CANCELLED' },
      });
    }

    // If SWAP request, swap the users on shifts
    if (request.requestType === 'SWAP' && request.swapTargetId && request.swapShiftId) {
      await this.prisma.$transaction([
        this.prisma.shift.update({
          where: { id: request.shiftId },
          data: { userId: request.swapTargetId },
        }),
        this.prisma.shift.update({
          where: { id: request.swapShiftId },
          data: { userId: request.requesterId },
        }),
      ]);
    }

    await this.auditService.log({
      companyId: request.companyId,
      userId: reviewerId,
      action: 'SHIFT_REQUEST_APPROVED',
      targetType: 'ShiftRequest',
      targetId: id,
      details: {
        requesterId: request.requesterId,
        reviewerNotes,
      },
    });

    // Notify requester
    const shiftDate = updated.shift.startTime.toLocaleDateString();
    await this.notificationsService.notifyShiftRequestApproved(
      request.requesterId,
      shiftDate,
    );

    return updated;
  }

  async decline(id: string, reviewerId: string, reviewerNotes?: string) {
    const request = await this.findOne(id);

    if (request.status !== 'PENDING') {
      throw new BadRequestException('Request has already been processed');
    }

    const updated = await this.prisma.shiftRequest.update({
      where: { id },
      data: {
        status: 'DECLINED',
        reviewedById: reviewerId,
        reviewedAt: new Date(),
        reviewerNotes,
      },
      include: {
        shift: {
          include: { job: true },
        },
        requester: true,
        reviewedBy: true,
      },
    });

    await this.auditService.log({
      companyId: request.companyId,
      userId: reviewerId,
      action: 'SHIFT_REQUEST_DECLINED',
      targetType: 'ShiftRequest',
      targetId: id,
      details: {
        requesterId: request.requesterId,
        reviewerNotes,
      },
    });

    // Notify requester
    const shiftDate = request.shift.startTime.toLocaleDateString();
    await this.notificationsService.notifyShiftRequestDeclined(
      request.requesterId,
      shiftDate,
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

    const updated = await this.prisma.shiftRequest.update({
      where: { id },
      data: { status: 'CANCELLED' },
      include: {
        shift: {
          include: { job: true },
        },
        requester: true,
      },
    });

    await this.auditService.log({
      companyId: request.companyId,
      userId,
      action: 'SHIFT_REQUEST_CANCELLED',
      targetType: 'ShiftRequest',
      targetId: id,
    });

    return updated;
  }

  async getStats(companyId: string) {
    const [pending, approved, declined] = await Promise.all([
      this.prisma.shiftRequest.count({ where: { companyId, status: 'PENDING' } }),
      this.prisma.shiftRequest.count({ where: { companyId, status: 'APPROVED' } }),
      this.prisma.shiftRequest.count({ where: { companyId, status: 'DECLINED' } }),
    ]);

    return { pending, approved, declined, total: pending + approved + declined };
  }
}
