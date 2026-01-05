import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ShiftRequestType, ShiftRequestStatus, UserRole } from '@prisma/client';

@Injectable()
export class ShiftRequestsService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
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
      include: { user: true },
    });

    if (!shift) {
      throw new NotFoundException('Shift not found');
    }

    if (shift.userId !== data.requesterId) {
      throw new ForbiddenException('You can only request changes to your own shifts');
    }

    if (shift.companyId !== data.companyId) {
      throw new ForbiddenException('Shift does not belong to your company');
    }

    // Check for existing pending request on this shift
    const existingRequest = await this.prisma.shiftRequest.findFirst({
      where: {
        shiftId: data.shiftId,
        status: 'PENDING',
      },
    });

    if (existingRequest) {
      throw new BadRequestException('A pending request already exists for this shift');
    }

    // For swap requests, validate swap target
    if (data.requestType === 'SWAP') {
      if (!data.swapTargetId) {
        throw new BadRequestException('Swap target is required for swap requests');
      }

      const swapTarget = await this.prisma.user.findUnique({
        where: { id: data.swapTargetId },
      });

      if (!swapTarget || swapTarget.companyId !== data.companyId) {
        throw new BadRequestException('Invalid swap target');
      }
    }

    const request = await this.prisma.shiftRequest.create({
      data: {
        companyId: data.companyId,
        shiftId: data.shiftId,
        requesterId: data.requesterId,
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
        reason: data.reason,
      },
    });

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
          include: { job: true, user: true },
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
        swapTarget: true,
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

    // Handle the actual shift change based on request type
    if (request.requestType === 'DROP') {
      // Cancel the shift
      await this.prisma.shift.update({
        where: { id: request.shiftId },
        data: { status: 'CANCELLED' },
      });
    } else if (request.requestType === 'SWAP' && request.swapTargetId) {
      // Swap the shift assignment
      await this.prisma.shift.update({
        where: { id: request.shiftId },
        data: { userId: request.swapTargetId },
      });
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
        shift: { include: { job: true } },
        requester: true,
        swapTarget: true,
        reviewedBy: true,
      },
    });

    await this.auditService.log({
      companyId: request.companyId,
      userId: reviewerId,
      action: 'SHIFT_REQUEST_APPROVED',
      targetType: 'ShiftRequest',
      targetId: id,
      details: {
        requestType: request.requestType,
        requesterId: request.requesterId,
        reviewerNotes,
      },
    });

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
        shift: { include: { job: true } },
        requester: true,
        swapTarget: true,
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
        requestType: request.requestType,
        requesterId: request.requesterId,
        reviewerNotes,
      },
    });

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
        shift: { include: { job: true } },
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
