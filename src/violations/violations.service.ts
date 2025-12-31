import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ViolationsService {
  constructor(private prisma: PrismaService) {}

  async findAll(companyId: string, filters?: any) {
    const where: any = { companyId };

    if (filters?.userId) where.userId = filters.userId;
    if (typeof filters?.reviewed !== 'undefined') where.reviewed = filters.reviewed;
    if (filters?.severity) where.severity = filters.severity;

    return this.prisma.violation.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, phone: true } },
        timeEntry: { include: { job: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async markAsReviewed(companyId: string, violationId: string, reviewedBy: string) {
    return this.prisma.violation.update({
      where: { id: violationId },
      data: {
        reviewed: true,
        reviewedBy,
        reviewedAt: new Date(),
      },
    });
  }

  async getViolationStats(companyId: string) {
    const total = await this.prisma.violation.count({
      where: { companyId },
    });

    const unreviewed = await this.prisma.violation.count({
      where: { companyId, reviewed: false },
    });

    const bySeverity = await this.prisma.violation.groupBy({
      by: ['severity'],
      where: { companyId },
      _count: true,
    });

    return {
      total,
      unreviewed,
      bySeverity,
    };
  }
}
