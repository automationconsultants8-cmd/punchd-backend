import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class ShiftTemplatesService {
  constructor(private prisma: PrismaService) {}

  async findAll(companyId: string) {
    const templates = await this.prisma.shiftTemplate.findMany({
      where: { companyId, isActive: true },
      include: { job: true },
      orderBy: { name: 'asc' },
    });

    const templatesWithCounts = await Promise.all(
      templates.map(async (t) => {
        const workerCount = await this.prisma.shift.groupBy({
          by: ['userId'],
          where: { templateId: t.id, userId: { not: null } },
        });
        return { ...t, assignedWorkerCount: workerCount.length };
      })
    );

    return templatesWithCounts;
  }

  async findOne(id: string, companyId: string) {
    const template = await this.prisma.shiftTemplate.findFirst({
      where: { id, companyId },
      include: { job: true },
    });
    if (!template) throw new NotFoundException('Template not found');
    return template;
  }

  async create(companyId: string, data: {
    name: string;
    daysOfWeek: number[];
    startTime: string;
    endTime: string;
    jobId?: string;
    notes?: string;
  }) {
    return this.prisma.shiftTemplate.create({
      data: { ...data, companyId },
      include: { job: true },
    });
  }

  async update(id: string, companyId: string, data: {
    name?: string;
    daysOfWeek?: number[];
    startTime?: string;
    endTime?: string;
    jobId?: string;
    notes?: string;
  }) {
    await this.findOne(id, companyId);
    return this.prisma.shiftTemplate.update({
      where: { id },
      data,
      include: { job: true },
    });
  }

  async delete(id: string, companyId: string) {
    await this.findOne(id, companyId);
    
    await this.prisma.shift.deleteMany({
      where: {
        templateId: id,
        shiftDate: { gte: new Date() },
      },
    });

    return this.prisma.shiftTemplate.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async assignWorkers(
    templateId: string,
    companyId: string,
    data: {
      userIds: string[];
      startDate: string;
      endDate: string;
    }
  ) {
    const template = await this.findOne(templateId, companyId);
    const batchId = uuidv4();
    const shifts: any[] = [];

    const start = new Date(data.startDate);
    const end = new Date(data.endDate);

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dayOfWeek = d.getDay();
      
      if (template.daysOfWeek.includes(dayOfWeek)) {
        const shiftDate = new Date(d);
        
        const [startHour, startMin] = template.startTime.split(':').map(Number);
        const [endHour, endMin] = template.endTime.split(':').map(Number);

        const startTime = new Date(shiftDate);
        startTime.setHours(startHour, startMin, 0, 0);

        const endTime = new Date(shiftDate);
        endTime.setHours(endHour, endMin, 0, 0);

        for (const userId of data.userIds) {
          shifts.push({
            companyId,
            userId,
            jobId: template.jobId,
            shiftDate,
            startTime,
            endTime,
            templateId,
            assignmentBatchId: batchId,
            assignmentStatus: 'PENDING',
            notes: template.notes,
          });
        }
      }
    }

    if (shifts.length === 0) {
      throw new BadRequestException('No shifts to create for the selected dates and days');
    }

    await this.prisma.shift.createMany({ data: shifts });

    return {
      batchId,
      shiftsCreated: shifts.length,
      workersAssigned: data.userIds.length,
    };
  }

  async getAssignedWorkers(templateId: string, companyId: string) {
    await this.findOne(templateId, companyId);

    const assignments = await this.prisma.shift.findMany({
      where: {
        templateId,
        userId: { not: null },
        shiftDate: { gte: new Date() },
      },
      select: {
        userId: true,
        user: { select: { id: true, name: true, phone: true } },
        shiftDate: true,
        assignmentStatus: true,
      },
      orderBy: { shiftDate: 'asc' },
    });

    const workerMap = new Map<string, any>();
    
    for (const a of assignments) {
      if (!a.userId) continue;
      
      if (!workerMap.has(a.userId)) {
        workerMap.set(a.userId, {
          user: a.user,
          shifts: [],
          status: a.assignmentStatus,
        });
      }
      workerMap.get(a.userId).shifts.push(a.shiftDate);
    }

    return Array.from(workerMap.values()).map((w) => ({
      ...w.user,
      startDate: w.shifts[0],
      endDate: w.shifts[w.shifts.length - 1],
      shiftCount: w.shifts.length,
      status: w.status,
    }));
  }

  async removeWorker(templateId: string, userId: string, companyId: string) {
    await this.findOne(templateId, companyId);

    const result = await this.prisma.shift.deleteMany({
      where: {
        templateId,
        userId,
        shiftDate: { gte: new Date() },
      },
    });

    return { deleted: result.count };
  }

  async createOneOff(companyId: string, data: {
    date: string;
    startTime: string;
    endTime: string;
    jobId?: string;
    userIds: string[];
    notes?: string;
  }) {
    const batchId = uuidv4();
    const shiftDate = new Date(data.date);
    
    const [startHour, startMin] = data.startTime.split(':').map(Number);
    const [endHour, endMin] = data.endTime.split(':').map(Number);

    const startTime = new Date(shiftDate);
    startTime.setHours(startHour, startMin, 0, 0);

    const endTime = new Date(shiftDate);
    endTime.setHours(endHour, endMin, 0, 0);

    const shifts = data.userIds.map((userId) => ({
      companyId,
      userId,
      jobId: data.jobId || null,
      shiftDate,
      startTime,
      endTime,
      assignmentBatchId: batchId,
      assignmentStatus: 'PENDING' as const,
      notes: data.notes,
    }));

    await this.prisma.shift.createMany({ data: shifts });

    return {
      batchId,
      shiftsCreated: shifts.length,
    };
  }

  async respondToShift(userId: string, batchId: string, accept: boolean, declineReason?: string) {
    const shifts = await this.prisma.shift.findMany({
      where: { userId, assignmentBatchId: batchId },
    });

    if (shifts.length === 0) {
      throw new NotFoundException('No shifts found for this assignment');
    }

    await this.prisma.shift.updateMany({
      where: { userId, assignmentBatchId: batchId },
      data: {
        assignmentStatus: accept ? 'ACCEPTED' : 'DECLINED',
        declineReason: accept ? null : declineReason,
        respondedAt: new Date(),
      },
    });

    return { updated: shifts.length, status: accept ? 'ACCEPTED' : 'DECLINED' };
  }

  async getTodayShifts(companyId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const shifts = await this.prisma.shift.findMany({
      where: {
        companyId,
        shiftDate: { gte: today, lt: tomorrow },
      },
      include: {
        user: { select: { id: true, name: true, phone: true } },
        job: { select: { id: true, name: true } },
      },
      orderBy: { startTime: 'asc' },
    });

    const byJob = new Map<string, any>();
    
    for (const s of shifts) {
      const jobKey = s.job?.id || 'unassigned';
      const jobName = s.job?.name || 'No Location';
      
      if (!byJob.has(jobKey)) {
        byJob.set(jobKey, {
          jobId: s.job?.id,
          jobName,
          startTime: s.startTime,
          endTime: s.endTime,
          workers: [],
          confirmed: 0,
          pending: 0,
          declined: 0,
        });
      }
      
      const group = byJob.get(jobKey);
      group.workers.push({
        ...s.user,
        status: s.assignmentStatus,
      });
      
      if (s.assignmentStatus === 'ACCEPTED') group.confirmed++;
      else if (s.assignmentStatus === 'PENDING') group.pending++;
      else if (s.assignmentStatus === 'DECLINED') group.declined++;
    }

    return Array.from(byJob.values());
  }

  async getMyShifts(userId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return this.prisma.shift.findMany({
      where: {
        userId,
        shiftDate: { gte: today },
      },
      include: {
        job: { select: { id: true, name: true, address: true } },
        template: { select: { id: true, name: true } },
      },
      orderBy: { shiftDate: 'asc' },
    });
  }

  async getPendingAssignments(userId: string) {
    const shifts = await this.prisma.shift.findMany({
      where: {
        userId,
        assignmentStatus: 'PENDING',
        shiftDate: { gte: new Date() },
      },
      include: {
        job: { select: { id: true, name: true, address: true } },
      },
      orderBy: { shiftDate: 'asc' },
    });

    const batches = new Map<string, any>();
    
    for (const s of shifts) {
      const batchId = s.assignmentBatchId || s.id;
      
      if (!batches.has(batchId)) {
        batches.set(batchId, {
          batchId,
          job: s.job,
          shifts: [],
          notes: s.notes,
        });
      }
      
      batches.get(batchId).shifts.push({
        id: s.id,
        date: s.shiftDate,
        startTime: s.startTime,
        endTime: s.endTime,
      });
    }

    return Array.from(batches.values());
  }
}
