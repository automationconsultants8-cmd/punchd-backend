import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type AuditAction = 
  | 'USER_CREATED'
  | 'USER_UPDATED'
  | 'USER_APPROVED'
  | 'USER_REJECTED'
  | 'USER_DEACTIVATED'
  | 'USER_PHONE_CHANGED'
  | 'USER_ROLE_CHANGED'
  | 'JOB_CREATED'
  | 'JOB_UPDATED'
  | 'JOB_DELETED'
  | 'SHIFT_CREATED'
  | 'SHIFT_UPDATED'
  | 'SHIFT_DELETED'
  | 'COMPANY_SETTINGS_UPDATED'
  | 'LOGIN'
  | 'PASSWORD_RESET'
  | 'TIME_ENTRY_APPROVED'
  | 'TIME_ENTRY_REJECTED'
  | 'PAY_RATE_UPDATED'
  | 'OVERTIME_SETTINGS_UPDATED';

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  async log(params: {
    companyId: string;
    userId?: string;
    action: AuditAction;
    targetType?: string;
    targetId?: string;
    details?: Record<string, any>;
    ipAddress?: string;
  }) {
    try {
      await this.prisma.auditLog.create({
        data: {
          companyId: params.companyId,
          userId: params.userId,
          action: params.action,
          targetType: params.targetType,
          targetId: params.targetId,
          details: params.details || {},
          ipAddress: params.ipAddress,
        },
      });
      console.log(`📝 Audit: ${params.action} by ${params.userId || 'system'} on ${params.targetType}:${params.targetId}`);
    } catch (err) {
      console.error('Failed to create audit log:', err);
    }
  }

  async getAuditLogs(
    companyId: string,
    options?: {
      limit?: number;
      offset?: number;
      action?: AuditAction;
      userId?: string;
      targetId?: string;
      startDate?: Date;
      endDate?: Date;
    }
  ) {
    const where: any = { companyId };

    if (options?.action) {
      where.action = options.action;
    }
    if (options?.userId) {
      where.userId = options.userId;
    }
    if (options?.targetId) {
      where.targetId = options.targetId;
    }
    if (options?.startDate || options?.endDate) {
      where.createdAt = {};
      if (options?.startDate) {
        where.createdAt.gte = options.startDate;
      }
      if (options?.endDate) {
        where.createdAt.lte = options.endDate;
      }
    }

    const [logs, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: options?.limit || 50,
        skip: options?.offset || 0,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { logs, total };
  }
}
