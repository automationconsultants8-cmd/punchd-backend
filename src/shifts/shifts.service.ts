import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ShiftStatus } from '@prisma/client';

@Injectable()
export class ShiftsService {
  constructor(private prisma: PrismaService) {}

  async create(data: {
    companyId: string;
    userId: string;
    jobId: string;
    shiftDate: Date;
    startTime: Date;
    endTime: Date;
    notes?: string;
  }) {
    return this.prisma.shift.create({
      data: {
        companyId: data.companyId,
        userId: data.userId,
        jobId: data.jobId,
        shiftDate: data.shiftDate,
        startTime: data.startTime,
        endTime: data.endTime,
        notes: data.notes,
        status: 'SCHEDULED',
      },
      include: {
        user: true,
        job: true,
      },
    });
  }

  async findAll(companyId: string, filters?: {
    userId?: string;
    jobId?: string;
    startDate?: Date;
    endDate?: Date;
    status?: ShiftStatus;
  }) {
    const where: any = { companyId };

    if (filters?.userId) where.userId = filters.userId;
    if (filters?.jobId) where.jobId = filters.jobId;
    if (filters?.status) where.status = filters.status;

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

  async findByUser(userId: string, filters?: {
    startDate?: Date;
    endDate?: Date;
    status?: ShiftStatus;
  }) {
    const where: any = { userId };

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

  async update(id: string, data: {
    userId?: string;
    jobId?: string;
    shiftDate?: Date;
    startTime?: Date;
    endTime?: Date;
    status?: ShiftStatus;
    notes?: string;
  }) {
    await this.findOne(id);

    return this.prisma.shift.update({
      where: { id },
      data,
      include: {
        user: true,
        job: true,
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);

    return this.prisma.shift.delete({
      where: { id },
    });
  }

  async createMany(shifts: {
    companyId: string;
    userId: string;
    jobId: string;
    shiftDate: Date;
    startTime: Date;
    endTime: Date;
    notes?: string;
  }[]) {
    return this.prisma.shift.createMany({
      data: shifts.map(shift => ({
        ...shift,
        status: 'SCHEDULED' as ShiftStatus,
      })),
    });
  }

  async getTodayShifts(companyId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    return this.prisma.shift.findMany({
      where: {
        companyId,
        shiftDate: {
          gte: today,
          lt: tomorrow,
        },
      },
      include: {
        user: true,
        job: true,
      },
      orderBy: { startTime: 'asc' },
    });
  }
}