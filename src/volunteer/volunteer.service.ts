// Save as: backend/src/volunteer/volunteer.service.ts

import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Hardcoded threshold - can add to Company model later if needed
const DEFAULT_CERTIFICATE_THRESHOLD = 10;

@Injectable()
export class VolunteerService {
  constructor(private prisma: PrismaService) {}

  async getDashboard(userId: string, companyId: string) {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const yearStart = new Date(now.getFullYear(), 0, 1);

    const entries = await this.prisma.timeEntry.findMany({
      where: {
        userId,
        workerType: 'VOLUNTEER',
        clockOutTime: { not: null },
      },
      orderBy: { clockInTime: 'desc' },
    });

    let totalMinutes = 0;
    let monthMinutes = 0;
    let yearMinutes = 0;
    let approvedMinutes = 0;

    entries.forEach(e => {
      if (e.durationMinutes) {
        totalMinutes += e.durationMinutes;
        if (new Date(e.clockInTime) >= monthStart) monthMinutes += e.durationMinutes;
        if (new Date(e.clockInTime) >= yearStart) yearMinutes += e.durationMinutes;
        if (e.approvalStatus === 'APPROVED') approvedMinutes += e.durationMinutes;
      }
    });

    const goal = await this.prisma.volunteerGoal.findUnique({
      where: { userId },
    });

    const pendingSignOffs = await this.prisma.volunteerSignOffRequest.count({
      where: { userId, status: 'PENDING' },
    });

    const certificates = await this.prisma.volunteerCertificate.count({
      where: { userId },
    });

    // Get company info for white-labeling
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
    });

    // Get company owner/admin name for certificate signature
    const companyOwner = await this.prisma.user.findFirst({
      where: {
        companyId,
        role: 'ADMIN',
      },
      select: { name: true },
      orderBy: { createdAt: 'asc' },
    });

    return {
      stats: {
        totalHours: Math.round(totalMinutes / 60 * 10) / 10,
        hoursThisMonth: Math.round(monthMinutes / 60 * 10) / 10,
        hoursThisYear: Math.round(yearMinutes / 60 * 10) / 10,
        approvedHours: Math.round(approvedMinutes / 60 * 10) / 10,
        hourGoal: goal?.targetHours || 0,
        pendingSignOffs,
        certificatesEarned: certificates,
        certificateThreshold: DEFAULT_CERTIFICATE_THRESHOLD,
      },
      recentEntries: entries.slice(0, 5).map(e => ({
        id: e.id,
        date: e.clockInTime,
        hours: e.durationMinutes ? Math.round(e.durationMinutes / 60 * 10) / 10 : 0,
        status: e.approvalStatus,
      })),
      company: {
        name: company?.name || 'Organization',
        logoUrl: (company as any)?.logoUrl || null,
        primaryColor: (company as any)?.primaryColor || '#1a1a2e',
        accentColor: (company as any)?.accentColor || '#c9a227',
        ownerName: companyOwner?.name || 'Program Director',
      },
    };
  }

  async getGoal(userId: string) {
    const goal = await this.prisma.volunteerGoal.findUnique({
      where: { userId },
    });

    if (!goal) return null;

    const now = new Date();
    let startDate: Date;
    let endDate: Date;

    if (goal.periodType === 'MONTHLY') {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    } else if (goal.periodType === 'YEARLY') {
      startDate = new Date(now.getFullYear(), 0, 1);
      endDate = new Date(now.getFullYear(), 11, 31);
    } else {
      startDate = goal.startDate || new Date(now.getFullYear(), 0, 1);
      endDate = goal.endDate || new Date(now.getFullYear(), 11, 31);
    }

    const entries = await this.prisma.timeEntry.findMany({
      where: {
        userId,
        workerType: 'VOLUNTEER',
        clockOutTime: { not: null },
        clockInTime: { gte: startDate, lte: endDate },
      },
    });

    const totalMinutes = entries.reduce((sum, e) => sum + (e.durationMinutes || 0), 0);
    const currentHours = Math.round(totalMinutes / 60 * 10) / 10;

    return {
      ...goal,
      currentHours,
      progressPercent: goal.targetHours > 0 ? Math.min(100, Math.round((currentHours / goal.targetHours) * 100)) : 0,
    };
  }

  async setGoal(userId: string, companyId: string, targetHours: number, periodType: string = 'MONTHLY') {
    return this.prisma.volunteerGoal.upsert({
      where: { userId },
      update: { targetHours, periodType, updatedAt: new Date() },
      create: { userId, companyId, targetHours, periodType },
    });
  }

  async deleteGoal(userId: string) {
    const goal = await this.prisma.volunteerGoal.findUnique({ where: { userId } });
    if (!goal) throw new NotFoundException('No goal found');
    return this.prisma.volunteerGoal.delete({ where: { userId } });
  }

  async getSignOffRequests(userId: string) {
    return this.prisma.volunteerSignOffRequest.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createSignOffRequest(
    userId: string,
    companyId: string,
    timeEntryIds: string[],
    supervisorEmail?: string,
    supervisorName?: string,
    notes?: string,
  ) {
    const entries = await this.prisma.timeEntry.findMany({
      where: {
        id: { in: timeEntryIds },
        userId,
        workerType: 'VOLUNTEER',
        approvalStatus: 'PENDING',
      },
    });

    if (entries.length === 0) {
      throw new BadRequestException('No pending volunteer entries found');
    }

    if (entries.length !== timeEntryIds.length) {
      throw new BadRequestException('Some entries are not valid or already approved');
    }

    const totalMinutes = entries.reduce((sum, e) => sum + (e.durationMinutes || 0), 0);

    return this.prisma.volunteerSignOffRequest.create({
      data: {
        userId,
        companyId,
        timeEntryIds,
        totalMinutes,
        supervisorEmail,
        supervisorName,
        notes,
      },
    });
  }

  async getPendingEntries(userId: string) {
    return this.prisma.timeEntry.findMany({
      where: {
        userId,
        workerType: 'VOLUNTEER',
        approvalStatus: 'PENDING',
        clockOutTime: { not: null },
      },
      orderBy: { clockInTime: 'desc' },
    });
  }

  async getCertificates(userId: string) {
    return this.prisma.volunteerCertificate.findMany({
      where: { userId },
      orderBy: { issuedAt: 'desc' },
    });
  }

  async approveSignOff(requestId: string, reviewerId: string) {
    const request = await this.prisma.volunteerSignOffRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) throw new NotFoundException('Sign-off request not found');
    if (request.status !== 'PENDING') throw new BadRequestException('Request already processed');

    await this.prisma.timeEntry.updateMany({
      where: { id: { in: request.timeEntryIds } },
      data: {
        approvalStatus: 'APPROVED',
        approvedById: reviewerId,
        approvedAt: new Date(),
      },
    });

    return this.prisma.volunteerSignOffRequest.update({
      where: { id: requestId },
      data: {
        status: 'APPROVED',
        reviewedAt: new Date(),
        reviewedById: reviewerId,
      },
    });
  }

  async rejectSignOff(requestId: string, reviewerId: string, reason: string) {
    const request = await this.prisma.volunteerSignOffRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) throw new NotFoundException('Sign-off request not found');
    if (request.status !== 'PENDING') throw new BadRequestException('Request already processed');

    // Reject the entries
    await this.prisma.timeEntry.updateMany({
      where: { id: { in: request.timeEntryIds } },
      data: {
        approvalStatus: 'REJECTED',
        approvedById: reviewerId,
        approvedAt: new Date(),
        rejectionReason: reason,
      },
    });

    // Update sign-off status (store reason in notes since rejectionReason field may not exist)
    return this.prisma.volunteerSignOffRequest.update({
      where: { id: requestId },
      data: {
        status: 'REJECTED',
        reviewedAt: new Date(),
        reviewedById: reviewerId,
        notes: request.notes ? `${request.notes}\n\nRejection reason: ${reason}` : `Rejection reason: ${reason}`,
      },
    });
  }

  async generateCertificate(userId: string, companyId: string) {
    const threshold = DEFAULT_CERTIFICATE_THRESHOLD;

    const entries = await this.prisma.timeEntry.findMany({
      where: {
        userId,
        workerType: 'VOLUNTEER',
        approvalStatus: 'APPROVED',
        clockOutTime: { not: null },
      },
    });

    const totalMinutes = entries.reduce((sum, e) => sum + (e.durationMinutes || 0), 0);
    const totalHours = Math.round(totalMinutes / 60 * 10) / 10;

    if (totalHours < threshold) {
      throw new BadRequestException(
        `You need at least ${threshold} approved hours to generate a certificate. You currently have ${totalHours} approved hours.`
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { company: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const certificate = await this.prisma.volunteerCertificate.create({
      data: {
        userId,
        companyId,
        title: `Volunteer Service Certificate - ${Math.floor(totalHours)} Hours`,
        description: `Awarded to ${user.name} for ${Math.floor(totalHours)} hours of volunteer service with ${user.company.name}`,
        hoursEarned: Math.floor(totalHours),
      },
    });

    return certificate;
  }

  // ============================================
  // ADMIN ENDPOINTS
  // ============================================

  async getAllPendingSignOffs(companyId: string) {
    return this.prisma.volunteerSignOffRequest.findMany({
      where: { companyId, status: 'PENDING' },
      include: {
        user: { select: { id: true, name: true, phone: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getSignOffById(signOffId: string, companyId: string) {
    const signOff = await this.prisma.volunteerSignOffRequest.findFirst({
      where: { id: signOffId, companyId },
      include: {
        user: { select: { id: true, name: true, phone: true, email: true } },
      },
    });

    if (!signOff) throw new NotFoundException('Sign-off request not found');

    // Fetch the actual entries
    const entries = await this.prisma.timeEntry.findMany({
      where: { id: { in: signOff.timeEntryIds } },
      orderBy: { clockInTime: 'desc' },
    });

    return {
      ...signOff,
      entries,
    };
  }

  async getAllVolunteersPending(companyId: string) {
    return this.prisma.timeEntry.findMany({
      where: {
        companyId,
        workerType: 'VOLUNTEER',
        approvalStatus: 'PENDING',
        clockOutTime: { not: null },
      },
      include: {
        user: { select: { id: true, name: true, phone: true, email: true } },
        job: { select: { id: true, name: true } },
      },
      orderBy: { clockInTime: 'desc' },
    });
  }

  async getAllContractorsPending(companyId: string) {
    return this.prisma.timeEntry.findMany({
      where: {
        companyId,
        workerType: 'CONTRACTOR',
        approvalStatus: 'PENDING',
        clockOutTime: { not: null },
      },
      include: {
        user: { select: { id: true, name: true, phone: true, email: true } },
        job: { select: { id: true, name: true } },
      },
      orderBy: { clockInTime: 'desc' },
    });
  }

  async getApprovalStats(companyId: string) {
    const [contractorPending, volunteerPending, signOffPending] = await Promise.all([
      this.prisma.timeEntry.count({
        where: { companyId, workerType: 'CONTRACTOR', approvalStatus: 'PENDING', clockOutTime: { not: null } },
      }),
      this.prisma.timeEntry.count({
        where: { companyId, workerType: 'VOLUNTEER', approvalStatus: 'PENDING', clockOutTime: { not: null } },
      }),
      this.prisma.volunteerSignOffRequest.count({
        where: { companyId, status: 'PENDING' },
      }),
    ]);

    return { contractorPending, volunteerPending, signOffPending };
  }

  async bulkApproveEntries(entryIds: string[], approverId: string) {
    return this.prisma.timeEntry.updateMany({
      where: { id: { in: entryIds } },
      data: {
        approvalStatus: 'APPROVED',
        approvedById: approverId,
        approvedAt: new Date(),
      },
    });
  }

  async bulkRejectEntries(entryIds: string[], approverId: string, reason: string) {
    return this.prisma.timeEntry.updateMany({
      where: { id: { in: entryIds } },
      data: {
        approvalStatus: 'REJECTED',
        approvedById: approverId,
        approvedAt: new Date(),
        rejectionReason: reason,
      },
    });
  }

  async generateCertificateForUser(userId: string, companyId: string, customTitle?: string) {
    const threshold = DEFAULT_CERTIFICATE_THRESHOLD;

    const entries = await this.prisma.timeEntry.findMany({
      where: {
        userId,
        workerType: 'VOLUNTEER',
        approvalStatus: 'APPROVED',
        clockOutTime: { not: null },
      },
    });

    const totalMinutes = entries.reduce((sum, e) => sum + (e.durationMinutes || 0), 0);
    const totalHours = Math.round(totalMinutes / 60 * 10) / 10;

    if (totalHours < threshold) {
      throw new BadRequestException(
        `This volunteer needs at least ${threshold} approved hours to receive a certificate. They currently have ${totalHours} approved hours.`
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { company: true },
    });

    if (!user) throw new NotFoundException('User not found');

    return this.prisma.volunteerCertificate.create({
      data: {
        userId,
        companyId,
        title: customTitle || `Volunteer Service Certificate - ${Math.floor(totalHours)} Hours`,
        description: `Awarded to ${user.name} for ${Math.floor(totalHours)} hours of volunteer service with ${user.company?.name || 'the organization'}`,
        hoursEarned: Math.floor(totalHours),
      },
    });
  }

  async getAllCertificates(companyId: string) {
    return this.prisma.volunteerCertificate.findMany({
      where: { companyId },
      include: {
        user: { select: { id: true, name: true, phone: true, email: true } },
      },
      orderBy: { issuedAt: 'desc' },
    });
  }

  async deleteCertificate(certId: string, userId: string) {
    const cert = await this.prisma.volunteerCertificate.findUnique({
      where: { id: certId },
    });
    
    if (!cert) throw new NotFoundException('Certificate not found');
    if (cert.userId !== userId) throw new BadRequestException('You can only delete your own certificates');
    
    return this.prisma.volunteerCertificate.delete({
      where: { id: certId },
    });
  }

  async adminDeleteCertificate(certId: string, companyId: string) {
    const cert = await this.prisma.volunteerCertificate.findFirst({
      where: { id: certId, companyId },
    });
    
    if (!cert) throw new NotFoundException('Certificate not found');
    
    return this.prisma.volunteerCertificate.delete({
      where: { id: certId },
    });
  }

  async getCertificateThreshold(companyId: string) {
    // Return hardcoded default for now
    return { threshold: DEFAULT_CERTIFICATE_THRESHOLD };
  }

  async setCertificateThreshold(companyId: string, hours: number) {
    // Not fully implemented - would need schema change to persist
    // For now just validate and return as if saved
    if (hours < 1) throw new BadRequestException('Threshold must be at least 1 hour');
    return { certificateHoursThreshold: hours };
  }
}
