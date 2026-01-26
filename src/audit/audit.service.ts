import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditAction } from '@prisma/client';

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  async log(data: {
    companyId: string;
    userId?: string;
    action: AuditAction;
    targetType?: string;
    targetId?: string;
    details?: Record<string, any>;
    ipAddress?: string;
  }) {
    return this.prisma.auditLog.create({
      data: {
        companyId: data.companyId,
        userId: data.userId,
        action: data.action,
        targetType: data.targetType,
        targetId: data.targetId,
        details: data.details || {},
        ipAddress: data.ipAddress,
      },
    });
  }

  async getAuditLogs(companyId: string, filters?: {
    action?: AuditAction;
    userId?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
  }) {
    const where: any = { companyId };
    
    if (filters?.action) where.action = filters.action;
    if (filters?.userId) where.userId = filters.userId;
    
    if (filters?.startDate || filters?.endDate) {
      where.createdAt = {};
      if (filters.startDate) where.createdAt.gte = filters.startDate;
      if (filters.endDate) where.createdAt.lte = filters.endDate;
    }

    return this.prisma.auditLog.findMany({
      where,
      include: {
        user: {
          select: { id: true, name: true, email: true }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: filters?.limit || 100,
    });
  }

  // Alias for consistency
  async findAll(companyId: string, filters?: {
    action?: AuditAction;
    userId?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
  }) {
    return this.getAuditLogs(companyId, filters);
  }

  async findByTarget(targetType: string, targetId: string) {
    return this.prisma.auditLog.findMany({
      where: { targetType, targetId },
      include: {
        user: {
          select: { id: true, name: true, email: true }
        }
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getStats(companyId: string) {
    const [total, creates, updates, deletes] = await Promise.all([
      this.prisma.auditLog.count({ where: { companyId } }),
      this.prisma.auditLog.count({ 
        where: { 
          companyId, 
          action: { in: ['USER_CREATED', 'TIME_ENTRY_CREATED', 'JOB_CREATED', 'SHIFT_CREATED', 'TIME_OFF_REQUEST_CREATED'] }
        } 
      }),
      this.prisma.auditLog.count({ 
        where: { 
          companyId, 
          action: { in: ['USER_UPDATED', 'TIME_ENTRY_EDITED', 'TIME_ENTRY_APPROVED', 'TIME_ENTRY_REJECTED', 'SHIFT_REQUEST_APPROVED'] }
        } 
      }),
      this.prisma.auditLog.count({ 
        where: { 
          companyId, 
          action: { in: ['USER_DELETED', 'TIME_ENTRY_ARCHIVED', 'SHIFT_DELETED'] }
        } 
      }),
    ]);

    return { total, creates, updates, deletes };
  }
}
