import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ShiftRequestType, ShiftRequestStatus, ShiftOfferStatus } from '@prisma/client';

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
    offerToUserIds?: string[];
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

    // Validate OFFER requests have recipients
    if (data.requestType === 'OFFER' && (!data.offerToUserIds || data.offerToUserIds.length === 0)) {
      throw new BadRequestException('Please select at least one coworker to offer this shift to');
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

    // If OFFER type, create offer records for each selected coworker
    if (data.requestType === 'OFFER' && data.offerToUserIds && data.offerToUserIds.length > 0) {
      await this.prisma.shiftOffer.createMany({
        data: data.offerToUserIds.map(userId => ({
          shiftRequestId: request.id,
          offeredToId: userId,
          status: 'PENDING',
        })),
      });

      // Get requester name for notifications
      const requester = await this.prisma.user.findUnique({
        where: { id: data.requesterId },
        select: { name: true },
      });

      // Notify each coworker
      const shiftDate = new Date(shift.shiftDate).toLocaleDateString();
      const jobName = shift.job?.name || 'a job site';
      
      await this.notificationsService.sendToUsers(data.offerToUserIds, {
        title: 'Shift Offered to You',
        body: `${requester?.name || 'A coworker'} offered you their ${jobName} shift on ${shiftDate}`,
        data: { 
          type: 'shift_offer', 
          screen: 'ShiftOffers',
          shiftRequestId: request.id,
        },
      });
    }

    await this.auditService.log({
      companyId: data.companyId,
      userId: data.requesterId,
      action: 'SHIFT_REQUEST_CREATED',
      targetType: 'ShiftRequest',
      targetId: request.id,
      details: {
        requestType: data.requestType,
        shiftId: data.shiftId,
        offerToUserIds: data.offerToUserIds,
      },
    });

    // Notify admins of DROP requests (OFFER requests don't need admin approval)
    if (data.requestType === 'DROP') {
      const requester = await this.prisma.user.findUnique({
        where: { id: data.requesterId },
        select: { name: true },
      });
      await this.notificationsService.notifyAdminsOfRequest(
        data.companyId,
        'shift',
        requester?.name || 'A worker',
      );
    }

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
        shiftOffers: {
          include: {
            offeredTo: {
              select: { id: true, name: true },
            },
          },
        },
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
        shiftOffers: {
          include: {
            offeredTo: {
              select: { id: true, name: true },
            },
          },
        },
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
        shiftOffers: {
          include: {
            offeredTo: {
              select: { id: true, name: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Get offers that have been made to the current user
  async findOffersForUser(userId: string) {
    return this.prisma.shiftOffer.findMany({
      where: {
        offeredToId: userId,
        status: 'PENDING',
      },
      include: {
        shiftRequest: {
          include: {
            shift: {
              include: { job: true },
            },
            requester: {
              select: { id: true, name: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Accept a shift offer
  async acceptOffer(offerId: string, userId: string) {
    const offer = await this.prisma.shiftOffer.findUnique({
      where: { id: offerId },
      include: {
        shiftRequest: {
          include: {
            shift: {
              include: { job: true },
            },
            requester: true,
          },
        },
      },
    });

    if (!offer) {
      throw new NotFoundException('Offer not found');
    }

    if (offer.offeredToId !== userId) {
      throw new ForbiddenException('This offer was not made to you');
    }

    if (offer.status !== 'PENDING') {
      throw new BadRequestException('This offer is no longer available');
    }

    if (offer.shiftRequest.status !== 'PENDING') {
      throw new BadRequestException('This shift is no longer available');
    }

    // Check for conflicts
    const shift = offer.shiftRequest.shift;
    const conflictingShift = await this.prisma.shift.findFirst({
      where: {
        userId,
        shiftDate: shift.shiftDate,
        status: { notIn: ['CANCELLED'] },
        id: { not: shift.id },
        OR: [
          {
            startTime: { lte: shift.endTime },
            endTime: { gte: shift.startTime },
          },
        ],
      },
    });

    if (conflictingShift) {
      throw new BadRequestException('You already have a shift during this time');
    }

    // Transaction: accept offer, decline others, transfer shift, update request
    const result = await this.prisma.$transaction(async (tx) => {
      // Accept this offer
      await tx.shiftOffer.update({
        where: { id: offerId },
        data: { status: 'ACCEPTED', respondedAt: new Date() },
      });

      // Decline all other offers for this request
      await tx.shiftOffer.updateMany({
        where: {
          shiftRequestId: offer.shiftRequestId,
          id: { not: offerId },
          status: 'PENDING',
        },
        data: { status: 'DECLINED', respondedAt: new Date() },
      });

      // Transfer the shift to the accepting user
      await tx.shift.update({
        where: { id: shift.id },
        data: { userId: userId },
      });

      // Mark the request as approved
      const updatedRequest = await tx.shiftRequest.update({
        where: { id: offer.shiftRequestId },
        data: {
          status: 'APPROVED',
          reviewedAt: new Date(),
        },
        include: {
          shift: { include: { job: true } },
          requester: true,
        },
      });

      return updatedRequest;
    });

    // Notify the original owner that their shift was accepted
    const acceptor = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });
    const shiftDate = new Date(shift.shiftDate).toLocaleDateString();
    const jobName = shift.job?.name || 'a job site';

    await this.notificationsService.sendToUsers([offer.shiftRequest.requesterId], {
      title: 'Shift Offer Accepted',
      body: `${acceptor?.name || 'A coworker'} accepted your ${jobName} shift on ${shiftDate}`,
      data: { type: 'shift_offer_accepted', screen: 'Schedule' },
    });

    await this.auditService.log({
      companyId: offer.shiftRequest.companyId,
      userId,
      action: 'SHIFT_REQUEST_APPROVED',
      targetType: 'ShiftRequest',
      targetId: offer.shiftRequestId,
      details: {
        acceptedByOffer: true,
        offerId,
      },
    });

    return result;
  }

  // Decline a shift offer
  async declineOffer(offerId: string, userId: string) {
    const offer = await this.prisma.shiftOffer.findUnique({
      where: { id: offerId },
      include: {
        shiftRequest: {
          include: {
            requester: true,
            shiftOffers: true,
          },
        },
      },
    });

    if (!offer) {
      throw new NotFoundException('Offer not found');
    }

    if (offer.offeredToId !== userId) {
      throw new ForbiddenException('This offer was not made to you');
    }

    if (offer.status !== 'PENDING') {
      throw new BadRequestException('This offer has already been responded to');
    }

    // Decline this offer
    await this.prisma.shiftOffer.update({
      where: { id: offerId },
      data: { status: 'DECLINED', respondedAt: new Date() },
    });

    // Check if all offers have been declined
    const pendingOffers = await this.prisma.shiftOffer.count({
      where: {
        shiftRequestId: offer.shiftRequestId,
        status: 'PENDING',
      },
    });

    // If no pending offers left, notify the requester
    if (pendingOffers === 0) {
      await this.notificationsService.sendToUsers([offer.shiftRequest.requesterId], {
        title: 'Shift Offer Update',
        body: 'All coworkers have declined your shift offer. You may want to submit a drop request instead.',
        data: { type: 'shift_offer_all_declined', screen: 'ShiftRequests' },
      });

      // Mark request as declined since no one accepted
      await this.prisma.shiftRequest.update({
        where: { id: offer.shiftRequestId },
        data: { status: 'DECLINED' },
      });
    }

    return { success: true, remainingOffers: pendingOffers };
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

    // If OFFER type, also cancel all pending offers
    if (request.requestType === 'OFFER') {
      await this.prisma.shiftOffer.updateMany({
        where: {
          shiftRequestId: id,
          status: 'PENDING',
        },
        data: { status: 'EXPIRED' },
      });
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
