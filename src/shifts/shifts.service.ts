import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ShiftStatus } from '@prisma/client';

@Injectable()
export class ShiftsService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private notificationsService: NotificationsService,
  ) {}

  // Helper to parse date and time strings into Date objects
  private parseShiftDates(date: string | Date, startTime: string | Date, endTime: string | Date) {
    let shiftDate: Date;
    let start: Date;
    let end: Date;

    // Parse shiftDate
    if (date instanceof Date) {
      shiftDate = date;
    } else if (typeof date === 'string') {
      // Handle "2026-01-09" format
      shiftDate = new Date(date + 'T00:00:00');
    } else {
      throw new BadRequestException('Invalid date format');
    }

    // Parse startTime
    if (startTime instanceof Date) {
      start = startTime;
    } else if (typeof startTime === 'string') {
      // Handle "08:00" or "08:00 AM" format
      if (startTime.includes(':') && !startTime.includes('T')) {
        const timePart = this.parseTimeString(startTime);
        start = new Date(shiftDate);
        start.setHours(timePart.hours, timePart.minutes, 0, 0);
      } else {
        start = new Date(startTime);
      }
    } else {
      throw new BadRequestException('Invalid startTime format');
    }

    // Parse endTime
    if (endTime instanceof Date) {
      end = endTime;
    } else if (typeof endTime === 'string') {
      // Handle "17:00" or "05:00 PM" format
      if (endTime.includes(':') && !endTime.includes('T')) {
        const timePart = this.parseTimeString(endTime);
        end = new Date(shiftDate);
        end.setHours(timePart.hours, timePart.minutes, 0, 0);
      } else {
        end = new Date(endTime);
      }
    } else {
      throw new BadRequestException('Invalid endTime format');
    }

    // Validate dates
    if (isNaN(shiftDate.getTime())) {
      throw new BadRequestException('Invalid shift date');
    }
    if (isNaN(start.getTime())) {
      throw new BadRequestException('Invalid start time');
    }
    if (isNaN(end.getTime())) {
      throw new BadRequestException('Invalid end time');
    }

    return { shiftDate, startTime: start, endTime: end };
  }

  private parseTimeString(timeStr: string): { hours: number; minutes: number } {
    // Handle "08:00 AM", "5:00 PM", "17:00" formats
    let hours = 0;
    let minutes = 0;

    const upperTime = timeStr.toUpperCase().trim();
    const isPM = upperTime.includes('PM');
    const isAM = upperTime.includes('AM');

    // Remove AM/PM
    const cleanTime = upperTime.replace(/\s*(AM|PM)\s*/i, '').trim();
    const parts = cleanTime.split(':');

    hours = parseInt(parts[0], 10);
    minutes = parts[1] ? parseInt(parts[1], 10) : 0;

    // Convert to 24-hour format
    if (isPM && hours !== 12) {
      hours += 12;
    } else if (isAM && hours === 12) {
      hours = 0;
    }

    return { hours, minutes };
  }

  async create(data: {
    companyId: string;
    userId?: string;
    jobId: string;
    date?: string | Date;
    shiftDate?: string | Date;
    startTime: string | Date;
    endTime: string | Date;
    notes?: string;
    isOpen?: boolean;
  }) {
    // Use date or shiftDate (frontend might send either)
    const dateValue = data.date || data.shiftDate;
    if (!dateValue) {
      throw new BadRequestException('Date is required');
    }

    const parsed = this.parseShiftDates(dateValue, data.startTime, data.endTime);

    const shift = await this.prisma.shift.create({
      data: {
        companyId: data.companyId,
        userId: data.userId || null,
        jobId: data.jobId,
        shiftDate: parsed.shiftDate,
        startTime: parsed.startTime,
        endTime: parsed.endTime,
        notes: data.notes || '',
        isOpen: data.isOpen || !data.userId,
        status: data.isOpen || !data.userId ? 'OPEN' : 'SCHEDULED',
      },
      include: {
        user: true,
        job: true,
      },
    });

    await this.auditService.log({
      companyId: data.companyId,
      userId: data.userId,
      action: 'SHIFT_CREATED',
      targetType: 'Shift',
      targetId: shift.id,
      details: {
        jobId: data.jobId,
        shiftDate: parsed.shiftDate,
        isOpen: shift.isOpen,
      },
    });

    if (data.userId && !shift.isOpen) {
      const jobName = shift.job?.name || 'a job site';
      const shiftDateStr = parsed.shiftDate.toLocaleDateString();
      const startTimeStr = parsed.startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      await this.notificationsService.notifyNewShift(data.userId, jobName, shiftDateStr, startTimeStr);
    }

    return shift;
  }

  async findAll(companyId: string, filters?: {
    userId?: string;
    jobId?: string;
    status?: ShiftStatus;
    startDate?: Date;
    endDate?: Date;
    isOpen?: boolean;
  }) {
    const where: any = { companyId };

    if (filters?.userId) where.userId = filters.userId;
    if (filters?.jobId) where.jobId = filters.jobId;
    if (filters?.status) where.status = filters.status;
    if (filters?.isOpen !== undefined) where.isOpen = filters.isOpen;

    if (filters?.startDate || filters?.endDate) {
      where.shiftDate = {};
      if (filters.startDate) where.shiftDate.gte = filters.startDate;
      if (filters.endDate) where.shiftDate.lte = filters.endDate;
    }

    return this.prisma.shift.findMany({
      where,
      include: {
        user: true,
        job: true,
      },
      orderBy: [
        { shiftDate: 'asc' },
        { startTime: 'asc' },
      ],
    });
  }

  async findOne(id: string) {
    const shift = await this.prisma.shift.findUnique({
      where: { id },
      include: {
        user: true,
        job: true,
      },
    });

    if (!shift) {
      throw new NotFoundException('Shift not found');
    }

    return shift;
  }

async findByUser(userId: string, filters?: {
  startDate?: Date;
  endDate?: Date;
  status?: ShiftStatus;
}) {
  const where: any = { 
    userId: userId,
    isOpen: false,
    status: { notIn: ['CANCELLED'] },  // ADD THIS LINE
  };

  if (filters?.status) where.status = filters.status;

  if (filters?.startDate || filters?.endDate) {
    where.shiftDate = {};
    if (filters.startDate) where.shiftDate.gte = filters.startDate;
    if (filters.endDate) where.shiftDate.lte = filters.endDate;
  }

  return this.prisma.shift.findMany({
    where,
    include: {
      job: true,
    },
    orderBy: [
      { shiftDate: 'asc' },
      { startTime: 'asc' },
    ],
  });
}

async findOpenShifts(companyId: string) {
  const now = new Date();

  return this.prisma.shift.findMany({
    where: {
      companyId,
      isOpen: true,
      userId: null,
      // Only show shifts that haven't ended yet
      endTime: { gte: now },
    },
    include: {
      job: true,
    },
    orderBy: [
      { shiftDate: 'asc' },
      { startTime: 'asc' },
    ],
  });
}

  async claimShift(shiftId: string, userId: string, companyId: string) {
    const shift = await this.prisma.shift.findUnique({
      where: { id: shiftId },
      include: { job: true },
    });

    if (!shift) {
      throw new NotFoundException('Shift not found');
    }

    if (shift.companyId !== companyId) {
      throw new ForbiddenException('You cannot claim shifts from another company');
    }

    if (!shift.isOpen || shift.status !== 'OPEN') {
      throw new BadRequestException('This shift is no longer available');
    }

    if (shift.userId) {
      throw new BadRequestException('This shift has already been claimed');
    }

    const conflictingShift = await this.prisma.shift.findFirst({
      where: {
        userId,
        shiftDate: shift.shiftDate,
        status: { notIn: ['CANCELLED'] },
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

    const updatedShift = await this.prisma.shift.update({
      where: { id: shiftId },
      data: {
        userId,
        isOpen: false,
        status: 'SCHEDULED',
      },
      include: {
        user: true,
        job: true,
      },
    });

    await this.auditService.log({
      companyId,
      userId,
      action: 'SHIFT_CLAIMED',
      targetType: 'Shift',
      targetId: shiftId,
      details: {
        jobId: shift.jobId,
        shiftDate: shift.shiftDate,
      },
    });

    const worker = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });

    const admins = await this.prisma.user.findMany({
      where: {
        companyId,
        role: { in: ['ADMIN', 'OWNER', 'MANAGER'] },
        isActive: true,
      },
      select: { id: true },
    });

    const adminIds = admins.map(a => a.id);
    if (adminIds.length > 0) {
      const shiftDateStr = new Date(shift.shiftDate).toLocaleDateString();
      await this.notificationsService.sendToUsers(adminIds, {
        title: 'Shift Claimed',
        body: `${worker?.name || 'A worker'} claimed the ${shift.job?.name} shift on ${shiftDateStr}`,
        data: { type: 'shift_claimed', screen: 'Schedule' },
      });
    }

    return updatedShift;
  }

  async createOpenShift(data: {
    companyId: string;
    jobId: string;
    shiftDate: Date;
    startTime: Date;
    endTime: Date;
    notes?: string;
  }) {
    return this.create({
      ...data,
      isOpen: true,
    });
  }

  async markAsOpen(shiftId: string, adminId: string) {
    const shift = await this.findOne(shiftId);

    const updatedShift = await this.prisma.shift.update({
      where: { id: shiftId },
      data: {
        userId: null,
        isOpen: true,
        status: 'OPEN',
      },
      include: {
        user: true,
        job: true,
      },
    });

    await this.auditService.log({
      companyId: shift.companyId,
      userId: adminId,
      action: 'SHIFT_UPDATED',
      targetType: 'Shift',
      targetId: shiftId,
      details: { markedAsOpen: true },
    });

    return updatedShift;
  }

  async update(id: string, data: {
    userId?: string;
    jobId?: string;
    shiftDate?: Date;
    startTime?: Date;
    endTime?: Date;
    status?: ShiftStatus;
    notes?: string;
    isOpen?: boolean;
  }, updatedById: string) {
    const shift = await this.findOne(id);

    const updatedShift = await this.prisma.shift.update({
      where: { id },
      data: {
        ...data,
        ...(data.userId && { isOpen: false, status: 'SCHEDULED' }),
      },
      include: {
        user: true,
        job: true,
      },
    });

    await this.auditService.log({
      companyId: shift.companyId,
      userId: updatedById,
      action: 'SHIFT_UPDATED',
      targetType: 'Shift',
      targetId: id,
      details: data,
    });

    if (data.userId && data.userId !== shift.userId) {
      const jobName = updatedShift.job?.name || 'a job site';
      const shiftDateStr = new Date(updatedShift.shiftDate).toLocaleDateString();
      const startTimeStr = new Date(updatedShift.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      await this.notificationsService.notifyNewShift(data.userId, jobName, shiftDateStr, startTimeStr);
    }

    return updatedShift;
  }

  async delete(id: string, deletedById: string) {
    const shift = await this.findOne(id);

    if (shift.userId) {
      const jobName = shift.job?.name || 'a job site';
      const shiftDateStr = new Date(shift.shiftDate).toLocaleDateString();
      await this.notificationsService.notifyShiftCancelled(shift.userId, jobName, shiftDateStr);
    }

    await this.prisma.shift.delete({
      where: { id },
    });

    await this.auditService.log({
      companyId: shift.companyId,
      userId: deletedById,
      action: 'SHIFT_DELETED',
      targetType: 'Shift',
      targetId: id,
    });

    return { success: true };
  }

  async updateStatus(id: string, status: ShiftStatus, updatedById: string) {
    const shift = await this.findOne(id);

    const updatedShift = await this.prisma.shift.update({
      where: { id },
      data: { status },
      include: {
        user: true,
        job: true,
      },
    });

    await this.auditService.log({
      companyId: shift.companyId,
      userId: updatedById,
      action: 'SHIFT_UPDATED',
      targetType: 'Shift',
      targetId: id,
      details: { status },
    });

    return updatedShift;
  }

  async getUpcomingShifts(companyId: string, days: number = 7) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + days);

    return this.findAll(companyId, {
      startDate: today,
      endDate: endDate,
    });
  }

  async getStats(companyId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [scheduled, open, completed, cancelled] = await Promise.all([
      this.prisma.shift.count({
        where: { companyId, status: 'SCHEDULED', shiftDate: { gte: today } },
      }),
      this.prisma.shift.count({
        where: { companyId, isOpen: true, status: 'OPEN', shiftDate: { gte: today } },
      }),
      this.prisma.shift.count({
        where: { companyId, status: 'COMPLETED' },
      }),
      this.prisma.shift.count({
        where: { companyId, status: 'CANCELLED' },
      }),
    ]);

    return { scheduled, open, completed, cancelled };
  }
}
