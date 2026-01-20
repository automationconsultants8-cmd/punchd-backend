import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTimesheetDto, ReviewTimesheetDto } from './dto/timesheet.dto';

@Injectable()
export class TimesheetsService {
  constructor(private prisma: PrismaService) {}

  // Get all timesheets for a contractor
  async getMyTimesheets(userId: string, companyId: string) {
    return this.prisma.timesheet.findMany({
      where: { userId, companyId },
      include: {
        entries: {
          select: {
            id: true,
            clockInTime: true,
            clockOutTime: true,
            durationMinutes: true,
            breakMinutes: true,
          },
        },
        reviewedBy: {
          select: { id: true, name: true },
        },
      },
      orderBy: { periodStart: 'desc' },
    });
  }

  // Get timesheet by ID
  async getById(id: string, userId: string, companyId: string) {
    const timesheet = await this.prisma.timesheet.findFirst({
      where: { id, companyId },
      include: {
        entries: {
          include: {
            job: { select: { id: true, name: true } },
          },
          orderBy: { clockInTime: 'asc' },
        },
        user: { select: { id: true, name: true, email: true } },
        reviewedBy: { select: { id: true, name: true } },
      },
    });

    if (!timesheet) {
      throw new NotFoundException('Timesheet not found');
    }

    // Contractors can only see their own
    if (timesheet.userId !== userId) {
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (user?.role === 'WORKER') {
        throw new ForbiddenException('Access denied');
      }
    }

    return timesheet;
  }

  // Create a draft timesheet for a period
  async create(userId: string, companyId: string, dto: CreateTimesheetDto) {
    const periodStart = new Date(dto.periodStart);
    periodStart.setHours(0, 0, 0, 0);
    
    const periodEnd = new Date(dto.periodEnd);
    periodEnd.setHours(23, 59, 59, 999);

    // Check for overlapping timesheet
    const existing = await this.prisma.timesheet.findFirst({
      where: {
        userId,
        companyId,
        OR: [
          {
            periodStart: { lte: periodEnd },
            periodEnd: { gte: periodStart },
          },
        ],
        status: { not: 'REJECTED' },
      },
    });

    if (existing) {
      throw new BadRequestException('A timesheet already exists for this period');
    }

    // Get all time entries in this period that aren't already in a timesheet
    const entries = await this.prisma.timeEntry.findMany({
      where: {
        userId,
        companyId,
        clockInTime: { gte: periodStart, lte: periodEnd },
        clockOutTime: { not: null },
        timesheetId: null,
      },
    });

    if (entries.length === 0) {
      throw new BadRequestException('No completed time entries found for this period');
    }

    // Calculate totals
    const totalMinutes = entries.reduce((sum, e) => sum + (e.durationMinutes || 0), 0);
    const totalBreakMinutes = entries.reduce((sum, e) => sum + (e.breakMinutes || 0), 0);

    // Create timesheet and link entries
    const timesheet = await this.prisma.timesheet.create({
      data: {
        companyId,
        userId,
        periodStart,
        periodEnd,
        totalMinutes,
        totalBreakMinutes,
        status: 'DRAFT',
      },
    });

    // Link entries to timesheet
    await this.prisma.timeEntry.updateMany({
      where: { id: { in: entries.map(e => e.id) } },
      data: { timesheetId: timesheet.id },
    });

    return this.getById(timesheet.id, userId, companyId);
  }

  // Submit timesheet for approval
  async submit(timesheetId: string, userId: string, companyId: string) {
    const timesheet = await this.prisma.timesheet.findFirst({
      where: { id: timesheetId, userId, companyId },
    });

    if (!timesheet) {
      throw new NotFoundException('Timesheet not found');
    }

    if (timesheet.status !== 'DRAFT') {
      throw new BadRequestException('Only draft timesheets can be submitted');
    }

    return this.prisma.timesheet.update({
      where: { id: timesheetId },
      data: {
        status: 'SUBMITTED',
        submittedAt: new Date(),
      },
      include: {
        entries: true,
        user: { select: { id: true, name: true } },
      },
    });
  }

  // Withdraw a submitted timesheet (back to draft)
  async withdraw(timesheetId: string, userId: string, companyId: string) {
    const timesheet = await this.prisma.timesheet.findFirst({
      where: { id: timesheetId, userId, companyId },
    });

    if (!timesheet) {
      throw new NotFoundException('Timesheet not found');
    }

    if (timesheet.status !== 'SUBMITTED') {
      throw new BadRequestException('Only submitted timesheets can be withdrawn');
    }

    return this.prisma.timesheet.update({
      where: { id: timesheetId },
      data: {
        status: 'DRAFT',
        submittedAt: null,
      },
    });
  }

  // Admin: Get all pending timesheets for company
  async getPendingForCompany(companyId: string) {
    return this.prisma.timesheet.findMany({
      where: { companyId, status: 'SUBMITTED' },
      include: {
        user: { select: { id: true, name: true, email: true, phone: true } },
        entries: {
          select: {
            id: true,
            clockInTime: true,
            clockOutTime: true,
            durationMinutes: true,
          },
        },
      },
      orderBy: { submittedAt: 'asc' },
    });
  }

  // Admin: Review (approve/reject) a timesheet
  async review(timesheetId: string, reviewerId: string, companyId: string, dto: ReviewTimesheetDto) {
    const timesheet = await this.prisma.timesheet.findFirst({
      where: { id: timesheetId, companyId },
    });

    if (!timesheet) {
      throw new NotFoundException('Timesheet not found');
    }

    if (timesheet.status !== 'SUBMITTED') {
      throw new BadRequestException('Only submitted timesheets can be reviewed');
    }

    const updated = await this.prisma.timesheet.update({
      where: { id: timesheetId },
      data: {
        status: dto.status,
        reviewedAt: new Date(),
        reviewedById: reviewerId,
        reviewNotes: dto.notes,
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
        entries: true,
      },
    });

    // If rejected, unlink entries so they can be resubmitted
    if (dto.status === 'REJECTED') {
      await this.prisma.timeEntry.updateMany({
        where: { timesheetId },
        data: { timesheetId: null },
      });
    }

    return updated;
  }

  // Get unsubmitted entries for a user (for creating new timesheet)
  async getUnsubmittedEntries(userId: string, companyId: string, startDate?: string, endDate?: string) {
    const where: any = {
      userId,
      companyId,
      clockOutTime: { not: null },
      timesheetId: null,
    };

    if (startDate) {
      where.clockInTime = { ...where.clockInTime, gte: new Date(startDate) };
    }
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      where.clockInTime = { ...where.clockInTime, lte: end };
    }

    return this.prisma.timeEntry.findMany({
      where,
      include: {
        job: { select: { id: true, name: true } },
      },
      orderBy: { clockInTime: 'desc' },
    });
  }
}
