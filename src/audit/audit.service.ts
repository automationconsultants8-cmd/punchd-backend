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

  async findAll(companyId: string, filters?: {
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
      orderBy: { createdAt: 'desc' },
      take: filters?.limit || 100,
    });
  }

  async findByTarget(targetType: string, targetId: string) {
    return this.prisma.auditLog.findMany({
      where: { targetType, targetId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
