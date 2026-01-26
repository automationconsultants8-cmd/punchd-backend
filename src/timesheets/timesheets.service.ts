import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTimesheetDto, ReviewTimesheetDto, UpdateTimesheetDto } from './dto/timesheet.dto';

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
            workerType: true,
          },
        },
        reviewedBy: {
          select: { id: true, name: true },
        },
        _count: {
          select: { entries: true },
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

  // Create a draft timesheet with selected entries
  async create(userId: string, companyId: string, dto: CreateTimesheetDto) {
    // If entryIds provided, use those; otherwise fall back to date range
    let entries;
    let periodStart: Date;
    let periodEnd: Date;

    if (dto.entryIds && dto.entryIds.length > 0) {
      // Validate entries belong to user and aren't in another timesheet
      entries = await this.prisma.timeEntry.findMany({
        where: {
          id: { in: dto.entryIds },
          userId,
          companyId,
          clockOutTime: { not: null },
          timesheetId: null,
          isArchived: false,
        },
      });

      if (entries.length === 0) {
        throw new BadRequestException('No valid time entries found');
      }

      if (entries.length !== dto.entryIds.length) {
        throw new BadRequestException('Some entries are invalid, already in a timesheet, or archived');
      }

      // Calculate period from entries
      const dates = entries.map(e => new Date(e.clockInTime).getTime());
      periodStart = new Date(Math.min(...dates));
      periodStart.setHours(0, 0, 0, 0);
      periodEnd = new Date(Math.max(...dates));
      periodEnd.setHours(23, 59, 59, 999);
    } else {
      // Legacy: use date range
      periodStart = new Date(dto.periodStart);
      periodStart.setHours(0, 0, 0, 0);
      periodEnd = new Date(dto.periodEnd);
      periodEnd.setHours(23, 59, 59, 999);

      // Get all time entries in this period that aren't already in a timesheet
      entries = await this.prisma.timeEntry.findMany({
        where: {
          userId,
          companyId,
          clockInTime: { gte: periodStart, lte: periodEnd },
          clockOutTime: { not: null },
          timesheetId: null,
          isArchived: false,
        },
      });

      if (entries.length === 0) {
        throw new BadRequestException('No completed time entries found for this period');
      }
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
        name: dto.name || null,
      },
    });

    // Link entries to timesheet
    await this.prisma.timeEntry.updateMany({
      where: { id: { in: entries.map(e => e.id) } },
      data: { timesheetId: timesheet.id },
    });

    return this.getById(timesheet.id, userId, companyId);
  }

  // Update a draft timesheet (add/remove entries)
  async update(timesheetId: string, userId: string, companyId: string, dto: UpdateTimesheetDto) {
    const timesheet = await this.prisma.timesheet.findFirst({
      where: { id: timesheetId, userId, companyId },
      include: { entries: true },
    });

    if (!timesheet) {
      throw new NotFoundException('Timesheet not found');
    }

    if (timesheet.status !== 'DRAFT') {
      throw new BadRequestException('Only draft timesheets can be edited');
    }

    // Validate new entries
    if (dto.entryIds && dto.entryIds.length > 0) {
      const currentEntryIds = timesheet.entries.map(e => e.id);
      const newEntryIds = dto.entryIds.filter(id => !currentEntryIds.includes(id));

      // Validate new entries belong to user
      if (newEntryIds.length > 0) {
        const newEntries = await this.prisma.timeEntry.findMany({
          where: {
            id: { in: newEntryIds },
            userId,
            companyId,
            clockOutTime: { not: null },
            timesheetId: null,
            isArchived: false,
          },
        });

        if (newEntries.length !== newEntryIds.length) {
          throw new BadRequestException('Some entries are invalid, already in another timesheet, or archived');
        }
      }

      // Unlink entries being removed
      const entriesToRemove = currentEntryIds.filter(id => !dto.entryIds.includes(id));
      if (entriesToRemove.length > 0) {
        await this.prisma.timeEntry.updateMany({
          where: { id: { in: entriesToRemove } },
          data: { timesheetId: null },
        });
      }

      // Link new entries
      if (newEntryIds.length > 0) {
        await this.prisma.timeEntry.updateMany({
          where: { id: { in: newEntryIds } },
          data: { timesheetId: timesheetId },
        });
      }

      // Get updated entries to recalculate totals
      const updatedEntries = await this.prisma.timeEntry.findMany({
        where: { timesheetId },
      });

      // Calculate new totals and period
      const totalMinutes = updatedEntries.reduce((sum, e) => sum + (e.durationMinutes || 0), 0);
      const totalBreakMinutes = updatedEntries.reduce((sum, e) => sum + (e.breakMinutes || 0), 0);

      let periodStart = timesheet.periodStart;
      let periodEnd = timesheet.periodEnd;

      if (updatedEntries.length > 0) {
        const dates = updatedEntries.map(e => new Date(e.clockInTime).getTime());
        periodStart = new Date(Math.min(...dates));
        periodStart.setHours(0, 0, 0, 0);
        periodEnd = new Date(Math.max(...dates));
        periodEnd.setHours(23, 59, 59, 999);
      }

      await this.prisma.timesheet.update({
        where: { id: timesheetId },
        data: {
          totalMinutes,
          totalBreakMinutes,
          periodStart,
          periodEnd,
          name: dto.name !== undefined ? dto.name : timesheet.name,
        },
      });
    } else if (dto.name !== undefined) {
      // Just updating name
      await this.prisma.timesheet.update({
        where: { id: timesheetId },
        data: { name: dto.name },
      });
    }

    return this.getById(timesheetId, userId, companyId);
  }

  // Submit timesheet for approval
  async submit(timesheetId: string, userId: string, companyId: string) {
    const timesheet = await this.prisma.timesheet.findFirst({
      where: { id: timesheetId, userId, companyId },
      include: { entries: true },
    });

    if (!timesheet) {
      throw new NotFoundException('Timesheet not found');
    }

    if (timesheet.status !== 'DRAFT') {
      throw new BadRequestException('Only draft timesheets can be submitted');
    }

    if (timesheet.entries.length === 0) {
      throw new BadRequestException('Cannot submit an empty timesheet');
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
            workerType: true,
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

    // If approved, also approve all entries in the timesheet
    if (dto.status === 'APPROVED') {
      await this.prisma.timeEntry.updateMany({
        where: { timesheetId },
        data: { 
          approvalStatus: 'APPROVED',
          approvedById: reviewerId,
          approvedAt: new Date(),
        },
      });
    }

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
  // Now filters by workerType if provided
  async getUnsubmittedEntries(
    userId: string, 
    companyId: string, 
    startDate?: string, 
    endDate?: string,
    workerType?: string,
  ) {
    const where: any = {
      userId,
      companyId,
      clockOutTime: { not: null },
      timesheetId: null,
      isArchived: false,
    };

    if (workerType) {
      where.workerType = workerType;
    }

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

  async delete(timesheetId: string, userId: string, companyId: string) {
    const timesheet = await this.prisma.timesheet.findFirst({
      where: { id: timesheetId, userId, companyId },
    });

    if (!timesheet) {
      throw new NotFoundException('Timesheet not found');
    }

    if (timesheet.status !== 'DRAFT') {
      throw new BadRequestException('Only draft timesheets can be deleted');
    }

    // Unlink entries
    await this.prisma.timeEntry.updateMany({
      where: { timesheetId },
      data: { timesheetId: null },
    });

    // Delete timesheet
    await this.prisma.timesheet.delete({
      where: { id: timesheetId },
    });

    return { success: true };
  }
}
