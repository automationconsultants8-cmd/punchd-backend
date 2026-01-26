import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TimeOffType, TimeOffStatus, LeaveType } from '@prisma/client';

@Injectable()
export class TimeOffService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private notificationsService: NotificationsService,
  ) {}

  // Map TimeOffType to LeaveType for bucket lookup
  private mapTimeOffToLeaveType(timeOffType: TimeOffType): LeaveType | null {
    const mapping: Record<string, LeaveType | null> = {
      'PTO': 'PTO',
      'SICK': 'SICK',
      'BEREAVEMENT': 'BEREAVEMENT',
      'JURY_DUTY': 'JURY_DUTY',
      'UNPAID': null,  // No bucket for unpaid
      'OTHER': null,   // No bucket for other
    };
    return mapping[timeOffType] ?? null;
  }

  // Calculate hours from date range (8 hours per day)
  calculateHours(startDate: Date, endDate: Date, hoursPerDay: number = 8): number {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffTime = Math.abs(end.getTime() - start.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    return diffDays * hoursPerDay;
  }

  // Get worker's leave balance for a specific type
  async getWorkerBalance(userId: string, companyId: string, leaveType: LeaveType) {
    const policy = await this.prisma.leavePolicy.findFirst({
      where: { companyId, type: leaveType, isActive: true },
    });

    if (!policy) return null;

    const balance = await this.prisma.leaveBalance.findUnique({
      where: { userId_policyId: { userId, policyId: policy.id } },
      include: { policy: true },
    });

    return balance;
  }

  // Get all balances for a worker (for mobile app display)
  async getMyBalances(userId: string, companyId: string) {
    const balances = await this.prisma.leaveBalance.findMany({
      where: { userId, companyId },
      include: {
        policy: { select: { id: true, name: true, type: true, annualHours: true } },
      },
    });

    return balances.map(bal => ({
      type: bal.policy.type,
      name: bal.policy.name,
      total: bal.totalHours,
      used: bal.usedHours,
      available: bal.totalHours - bal.usedHours,
      annualAllowance: bal.policy.annualHours,
    }));
  }

  async create(data: {
    companyId: string;
    requesterId: string;
    timeOffType: TimeOffType;
    startDate: Date;
    endDate: Date;
    hoursRequested?: number;
    reason?: string;
  }) {
    // Validate dates
    if (data.startDate > data.endDate) {
      throw new BadRequestException('Start date must be before end date');
    }

    // Calculate hours if not provided
    const hoursRequested = data.hoursRequested || this.calculateHours(data.startDate, data.endDate);

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

    // Check balance if applicable
    const leaveType = this.mapTimeOffToLeaveType(data.timeOffType);
    let balanceInfo: any = null;
    let insufficientBalance = false;
    let noBalanceSetup = false;

    if (leaveType) {
      const balance = await this.getWorkerBalance(data.requesterId, data.companyId, leaveType);
      
      if (balance) {
        const available = balance.totalHours - balance.usedHours;
        balanceInfo = {
          policyId: balance.policyId,
          balanceId: balance.id,
          total: balance.totalHours,
          used: balance.usedHours,
          available,
          requested: hoursRequested,
          remaining: available - hoursRequested,
        };
        
        if (hoursRequested > available) {
          insufficientBalance = true;
        }
      } else {
        noBalanceSetup = true;
      }
    }

    const request = await this.prisma.timeOffRequest.create({
      data: {
        companyId: data.companyId,
        requesterId: data.requesterId,
        timeOffType: data.timeOffType,
        startDate: data.startDate,
        endDate: data.endDate,
        hoursRequested,
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
        hoursRequested,
        balanceInfo,
        insufficientBalance,
        noBalanceSetup,
      },
    });

    // Notify admins of new request
    const requester = await this.prisma.user.findUnique({
      where: { id: data.requesterId },
      select: { name: true },
    });

    // Build notification message with more details
    let notificationDetails = `${hoursRequested}h ${data.timeOffType}`;
    if (insufficientBalance) {
      notificationDetails += ' (INSUFFICIENT BALANCE)';
    } else if (noBalanceSetup) {
      notificationDetails += ' (NO BALANCE SET UP)';
    }

    await this.notificationsService.notifyAdminsOfRequest(
      data.companyId,
      'time_off',
      `${requester?.name || 'A worker'} - ${notificationDetails}`,
    );

    return {
      ...request,
      balanceInfo,
      insufficientBalance,
      noBalanceSetup,
    };
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

    const requests = await this.prisma.timeOffRequest.findMany({
      where,
      include: {
        requester: true,
        reviewedBy: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    // Enrich with balance info for each request
    const enrichedRequests = await Promise.all(
      requests.map(async (request) => {
        const leaveType = this.mapTimeOffToLeaveType(request.timeOffType);
        let balanceInfo = null;

        if (leaveType) {
          const balance = await this.getWorkerBalance(request.requesterId, companyId, leaveType);
          if (balance) {
            const available = balance.totalHours - balance.usedHours;
            balanceInfo = {
              total: balance.totalHours,
              used: balance.usedHours,
              available,
              requested: request.hoursRequested || this.calculateHours(request.startDate, request.endDate),
            };
          }
        }

        return {
          ...request,
          balanceInfo,
        };
      })
    );

    return enrichedRequests;
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

    const hoursRequested = request.hoursRequested || this.calculateHours(request.startDate, request.endDate);

    // Deduct from leave balance if applicable
    const leaveType = this.mapTimeOffToLeaveType(request.timeOffType);
    let balanceUpdated = false;
    let newBalance: any = null;

    if (leaveType) {
      const balance = await this.getWorkerBalance(request.requesterId, request.companyId, leaveType);
      
      if (balance) {
        // Update the balance - deduct hours
        const updated = await this.prisma.leaveBalance.update({
          where: { id: balance.id },
          data: {
            usedHours: balance.usedHours + hoursRequested,
          },
        });
        
        balanceUpdated = true;
        newBalance = {
          total: updated.totalHours,
          used: updated.usedHours,
          available: updated.totalHours - updated.usedHours,
          deducted: hoursRequested,
        };

        console.log(`📅 Leave balance updated: ${request.requester?.name} used ${hoursRequested}h of ${leaveType}. New balance: ${newBalance.available}h available`);
      }
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
        hoursRequested,
        reviewerNotes,
        balanceUpdated,
        newBalance,
      },
    });

    // Notify requester
    await this.notificationsService.notifyTimeOffApproved(
      request.requesterId,
      updated.startDate.toISOString().split('T')[0],
      updated.endDate.toISOString().split('T')[0],
    );

    return {
      ...updated,
      balanceUpdated,
      newBalance,
    };
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

    if (request.status !== 'PENDING' && request.status !== 'APPROVED') {
      throw new BadRequestException('This request cannot be cancelled');
    }

    const wasApproved = request.status === 'APPROVED';
    const hoursRequested = request.hoursRequested || this.calculateHours(request.startDate, request.endDate);

    // If was approved, refund the leave balance
    let balanceRefunded = false;
    let newBalance: any = null;

    if (wasApproved) {
      const leaveType = this.mapTimeOffToLeaveType(request.timeOffType);
      
      if (leaveType) {
        const balance = await this.getWorkerBalance(request.requesterId, request.companyId, leaveType);
        
        if (balance) {
          // Refund the hours
          const updated = await this.prisma.leaveBalance.update({
            where: { id: balance.id },
            data: {
              usedHours: Math.max(0, balance.usedHours - hoursRequested),
            },
          });
          
          balanceRefunded = true;
          newBalance = {
            total: updated.totalHours,
            used: updated.usedHours,
            available: updated.totalHours - updated.usedHours,
            refunded: hoursRequested,
          };

          console.log(`📅 Leave balance refunded: ${hoursRequested}h returned to ${leaveType}. New balance: ${newBalance.available}h available`);
        }
      }
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
      details: {
        wasApproved,
        balanceRefunded,
        hoursRefunded: balanceRefunded ? hoursRequested : 0,
        newBalance,
      },
    });

    return {
      ...updated,
      balanceRefunded,
      newBalance,
    };
  }

  async getStats(companyId: string) {
    const [pending, approved, declined] = await Promise.all([
      this.prisma.timeOffRequest.count({ where: { companyId, status: 'PENDING' } }),
      this.prisma.timeOffRequest.count({ where: { companyId, status: 'APPROVED' } }),
      this.prisma.timeOffRequest.count({ where: { companyId, status: 'DECLINED' } }),
    ]);

    return { pending, approved, declined, total: pending + approved + declined };
  }

  // Get days calculation (kept for backward compatibility)
  getDays(startDate: Date, endDate: Date): number {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffTime = Math.abs(end.getTime() - start.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    return diffDays;
  }
}
