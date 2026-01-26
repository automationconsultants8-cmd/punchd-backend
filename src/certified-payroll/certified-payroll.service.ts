import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import * as PDFDocument from 'pdfkit';

type ReportType = 'CLIENT_BILLING' | 'WORKER_SUMMARY' | 'WH347';

@Injectable()
export class ComplianceReportsService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
  ) {}

  // ============================================
  // GET JOBS (for dropdown - prevailing wage or all)
  // ============================================
  
  async getJobs(companyId: string, prevailingWageOnly = false) {
    const where: any = { companyId, isActive: true };
    if (prevailingWageOnly) {
      where.isPrevailingWage = true;
    }
    
    return this.prisma.job.findMany({
      where,
      select: {
        id: true,
        name: true,
        address: true,
        projectNumber: true,
        isPrevailingWage: true,
        defaultHourlyRate: true,
      },
      orderBy: { name: 'asc' },
    });
  }

  // ============================================
  // CLIENT BILLING REPORT
  // For invoicing clients - hours and costs by job
  // ============================================

  async generateClientBillingReport(
    companyId: string,
    userId: string,
    params: {
      jobId?: string;
      startDate: Date;
      endDate: Date;
      billRate?: number; // Override bill rate
    }
  ) {
    const { jobId, startDate, endDate, billRate } = params;

    // Get time entries
    const where: any = {
      companyId,
      clockOutTime: { not: null },
      approvalStatus: 'APPROVED',
      isArchived: false,
      workerType: { in: ['HOURLY', 'SALARIED'] },
      clockInTime: { gte: startDate, lte: endDate },
    };

    if (jobId) {
      where.jobId = jobId;
    }

    const entries = await this.prisma.timeEntry.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, phone: true, hourlyRate: true } },
        job: { select: { id: true, name: true, address: true, defaultHourlyRate: true } },
      },
      orderBy: [{ jobId: 'asc' }, { clockInTime: 'asc' }],
    });

    // Group by job
    const byJob: Record<string, {
      job: any;
      workers: Record<string, {
        worker: any;
        regularHours: number;
        overtimeHours: number;
        doubleTimeHours: number;
        totalHours: number;
        laborCost: number;
      }>;
      totalRegularHours: number;
      totalOvertimeHours: number;
      totalDoubleTimeHours: number;
      totalHours: number;
      totalLaborCost: number;
      totalBillable: number;
    }> = {};

    for (const entry of entries) {
      const jid = entry.jobId || 'unassigned';
      const jobName = entry.job?.name || 'Unassigned';

      if (!byJob[jid]) {
        byJob[jid] = {
          job: entry.job || { id: 'unassigned', name: 'Unassigned', address: '' },
          workers: {},
          totalRegularHours: 0,
          totalOvertimeHours: 0,
          totalDoubleTimeHours: 0,
          totalHours: 0,
          totalLaborCost: 0,
          totalBillable: 0,
        };
      }

      const wid = entry.userId;
      if (!byJob[jid].workers[wid]) {
        byJob[jid].workers[wid] = {
          worker: entry.user,
          regularHours: 0,
          overtimeHours: 0,
          doubleTimeHours: 0,
          totalHours: 0,
          laborCost: 0,
        };
      }

      const regHrs = (entry.regularMinutes || 0) / 60;
      const otHrs = (entry.overtimeMinutes || 0) / 60;
      const dtHrs = (entry.doubleTimeMinutes || 0) / 60;
      const totalHrs = regHrs + otHrs + dtHrs;
      const cost = entry.laborCost ? Number(entry.laborCost) : 0;

      byJob[jid].workers[wid].regularHours += regHrs;
      byJob[jid].workers[wid].overtimeHours += otHrs;
      byJob[jid].workers[wid].doubleTimeHours += dtHrs;
      byJob[jid].workers[wid].totalHours += totalHrs;
      byJob[jid].workers[wid].laborCost += cost;

      byJob[jid].totalRegularHours += regHrs;
      byJob[jid].totalOvertimeHours += otHrs;
      byJob[jid].totalDoubleTimeHours += dtHrs;
      byJob[jid].totalHours += totalHrs;
      byJob[jid].totalLaborCost += cost;

      // Calculate billable amount
      const rate = billRate || entry.job?.defaultHourlyRate || entry.user?.hourlyRate || 0;
      const billableAmount = totalHrs * Number(rate);
      byJob[jid].totalBillable += billableAmount;
    }

    // Convert workers object to array
    const jobSummaries = Object.values(byJob).map(j => ({
      ...j,
      workers: Object.values(j.workers),
    }));

    // Calculate grand totals
    const grandTotal = {
      regularHours: jobSummaries.reduce((sum, j) => sum + j.totalRegularHours, 0),
      overtimeHours: jobSummaries.reduce((sum, j) => sum + j.totalOvertimeHours, 0),
      doubleTimeHours: jobSummaries.reduce((sum, j) => sum + j.totalDoubleTimeHours, 0),
      totalHours: jobSummaries.reduce((sum, j) => sum + j.totalHours, 0),
      laborCost: jobSummaries.reduce((sum, j) => sum + j.totalLaborCost, 0),
      billable: jobSummaries.reduce((sum, j) => sum + j.totalBillable, 0),
    };

    return {
      reportType: 'CLIENT_BILLING',
      generatedAt: new Date(),
      dateRange: { startDate, endDate },
      jobSummaries,
      grandTotal,
      entryCount: entries.length,
    };
  }

  async generateClientBillingPDF(
    companyId: string,
    userId: string,
    params: {
      jobId?: string;
      startDate: Date;
      endDate: Date;
      billRate?: number;
    }
  ): Promise<Buffer> {
    const data = await this.generateClientBillingReport(companyId, userId, params);
    
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
    });

    const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));

    // Header
    doc.fontSize(20).font('Helvetica-Bold').text(company?.name || 'Company', 50, 50);
    doc.fontSize(16).text('Client Billing Report', 50, 75);
    doc.fontSize(10).font('Helvetica')
      .text(`Period: ${data.dateRange.startDate.toLocaleDateString()} - ${data.dateRange.endDate.toLocaleDateString()}`, 50, 95)
      .text(`Generated: ${new Date().toLocaleString()}`, 50, 108);

    let yPos = 140;

    for (const jobData of data.jobSummaries) {
      // Job header
      if (yPos > 650) {
        doc.addPage();
        yPos = 50;
      }

      doc.fontSize(14).font('Helvetica-Bold').fillColor('#333')
        .text(jobData.job.name, 50, yPos);
      yPos += 18;
      
      if (jobData.job.address) {
        doc.fontSize(9).font('Helvetica').fillColor('#666')
          .text(jobData.job.address, 50, yPos);
        yPos += 14;
      }

      // Table header
      yPos += 8;
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#000');
      doc.text('Worker', 50, yPos, { width: 150 });
      doc.text('Regular', 200, yPos, { width: 60, align: 'right' });
      doc.text('OT', 260, yPos, { width: 50, align: 'right' });
      doc.text('DT', 310, yPos, { width: 50, align: 'right' });
      doc.text('Total Hrs', 360, yPos, { width: 60, align: 'right' });
      doc.text('Cost', 420, yPos, { width: 70, align: 'right' });
      doc.text('Billable', 490, yPos, { width: 70, align: 'right' });
      
      yPos += 4;
      doc.moveTo(50, yPos + 10).lineTo(560, yPos + 10).stroke('#ccc');
      yPos += 16;

      // Workers
      doc.font('Helvetica').fontSize(9);
      for (const worker of jobData.workers) {
        if (yPos > 700) {
          doc.addPage();
          yPos = 50;
        }

        doc.fillColor('#000').text(worker.worker?.name || 'Unknown', 50, yPos, { width: 150 });
        doc.text(worker.regularHours.toFixed(1), 200, yPos, { width: 60, align: 'right' });
        doc.text(worker.overtimeHours.toFixed(1), 260, yPos, { width: 50, align: 'right' });
        doc.text(worker.doubleTimeHours.toFixed(1), 310, yPos, { width: 50, align: 'right' });
        doc.text(worker.totalHours.toFixed(1), 360, yPos, { width: 60, align: 'right' });
        doc.text(`$${worker.laborCost.toFixed(2)}`, 420, yPos, { width: 70, align: 'right' });
        // Billable = totalHours * job rate (simplified)
        doc.text(`$${worker.laborCost.toFixed(2)}`, 490, yPos, { width: 70, align: 'right' });
        yPos += 16;
      }

      // Job subtotal
      doc.moveTo(50, yPos).lineTo(560, yPos).stroke('#ccc');
      yPos += 6;
      doc.font('Helvetica-Bold').fillColor('#333');
      doc.text('Subtotal', 50, yPos, { width: 150 });
      doc.text(jobData.totalRegularHours.toFixed(1), 200, yPos, { width: 60, align: 'right' });
      doc.text(jobData.totalOvertimeHours.toFixed(1), 260, yPos, { width: 50, align: 'right' });
      doc.text(jobData.totalDoubleTimeHours.toFixed(1), 310, yPos, { width: 50, align: 'right' });
      doc.text(jobData.totalHours.toFixed(1), 360, yPos, { width: 60, align: 'right' });
      doc.text(`$${jobData.totalLaborCost.toFixed(2)}`, 420, yPos, { width: 70, align: 'right' });
      doc.text(`$${jobData.totalBillable.toFixed(2)}`, 490, yPos, { width: 70, align: 'right' });
      
      yPos += 30;
    }

    // Grand total
    if (yPos > 680) {
      doc.addPage();
      yPos = 50;
    }

    doc.rect(50, yPos, 510, 30).fill('#f5f5f5');
    yPos += 10;
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#000');
    doc.text('GRAND TOTAL', 55, yPos);
    doc.text(`${data.grandTotal.totalHours.toFixed(1)} hrs`, 360, yPos, { width: 60, align: 'right' });
    doc.text(`$${data.grandTotal.laborCost.toFixed(2)}`, 420, yPos, { width: 70, align: 'right' });
    doc.text(`$${data.grandTotal.billable.toFixed(2)}`, 490, yPos, { width: 70, align: 'right' });

    doc.end();

    return new Promise((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
    });
  }

  // ============================================
  // WORKER SUMMARY REPORT
  // Individual worker timesheets for client sign-off
  // ============================================

  async generateWorkerSummaryReport(
    companyId: string,
    userId: string,
    params: {
      workerId?: string;
      jobId?: string;
      startDate: Date;
      endDate: Date;
    }
  ) {
    const { workerId, jobId, startDate, endDate } = params;

    const where: any = {
      companyId,
      clockOutTime: { not: null },
      approvalStatus: 'APPROVED',
      isArchived: false,
      workerType: { in: ['HOURLY', 'SALARIED'] },
      clockInTime: { gte: startDate, lte: endDate },
    };

    if (workerId) where.userId = workerId;
    if (jobId) where.jobId = jobId;

    const entries = await this.prisma.timeEntry.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, phone: true, hourlyRate: true } },
        job: { select: { id: true, name: true, address: true } },
      },
      orderBy: [{ userId: 'asc' }, { clockInTime: 'asc' }],
    });

    // Group by worker
    const byWorker: Record<string, {
      worker: any;
      entries: any[];
      totalRegularHours: number;
      totalOvertimeHours: number;
      totalDoubleTimeHours: number;
      totalHours: number;
      totalPay: number;
    }> = {};

    for (const entry of entries) {
      const wid = entry.userId;

      if (!byWorker[wid]) {
        byWorker[wid] = {
          worker: entry.user,
          entries: [],
          totalRegularHours: 0,
          totalOvertimeHours: 0,
          totalDoubleTimeHours: 0,
          totalHours: 0,
          totalPay: 0,
        };
      }

      const regHrs = (entry.regularMinutes || 0) / 60;
      const otHrs = (entry.overtimeMinutes || 0) / 60;
      const dtHrs = (entry.doubleTimeMinutes || 0) / 60;
      const totalHrs = regHrs + otHrs + dtHrs;
      const pay = entry.laborCost ? Number(entry.laborCost) : 0;

      byWorker[wid].entries.push({
        id: entry.id,
        date: entry.clockInTime,
        job: entry.job?.name || 'Unassigned',
        clockIn: entry.clockInTime,
        clockOut: entry.clockOutTime,
        breakMinutes: entry.breakMinutes || 0,
        regularHours: regHrs,
        overtimeHours: otHrs,
        doubleTimeHours: dtHrs,
        totalHours: totalHrs,
        pay,
      });

      byWorker[wid].totalRegularHours += regHrs;
      byWorker[wid].totalOvertimeHours += otHrs;
      byWorker[wid].totalDoubleTimeHours += dtHrs;
      byWorker[wid].totalHours += totalHrs;
      byWorker[wid].totalPay += pay;
    }

    const workerSummaries = Object.values(byWorker);

    const grandTotal = {
      regularHours: workerSummaries.reduce((sum, w) => sum + w.totalRegularHours, 0),
      overtimeHours: workerSummaries.reduce((sum, w) => sum + w.totalOvertimeHours, 0),
      doubleTimeHours: workerSummaries.reduce((sum, w) => sum + w.totalDoubleTimeHours, 0),
      totalHours: workerSummaries.reduce((sum, w) => sum + w.totalHours, 0),
      totalPay: workerSummaries.reduce((sum, w) => sum + w.totalPay, 0),
    };

    return {
      reportType: 'WORKER_SUMMARY',
      generatedAt: new Date(),
      dateRange: { startDate, endDate },
      workerSummaries,
      grandTotal,
      entryCount: entries.length,
    };
  }

  async generateWorkerSummaryPDF(
    companyId: string,
    userId: string,
    params: {
      workerId?: string;
      jobId?: string;
      startDate: Date;
      endDate: Date;
    }
  ): Promise<Buffer> {
    const data = await this.generateWorkerSummaryReport(companyId, userId, params);
    
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
    });

    const doc = new PDFDocument({ size: 'LETTER', layout: 'landscape', margin: 40 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));

    // Header
    doc.fontSize(18).font('Helvetica-Bold').text(company?.name || 'Company', 40, 30);
    doc.fontSize(14).text('Worker Summary Report', 40, 52);
    doc.fontSize(9).font('Helvetica')
      .text(`Period: ${data.dateRange.startDate.toLocaleDateString()} - ${data.dateRange.endDate.toLocaleDateString()}`, 40, 70)
      .text(`Generated: ${new Date().toLocaleString()}`, 40, 82);

    let yPos = 110;

    for (const workerData of data.workerSummaries) {
      if (yPos > 500) {
        doc.addPage();
        yPos = 40;
      }

      // Worker header
      doc.fontSize(12).font('Helvetica-Bold').fillColor('#333')
        .text(workerData.worker?.name || 'Unknown Worker', 40, yPos);
      yPos += 18;

      // Table header
      doc.fontSize(8).font('Helvetica-Bold').fillColor('#000');
      doc.text('Date', 40, yPos, { width: 70 });
      doc.text('Job Site', 110, yPos, { width: 140 });
      doc.text('Clock In', 250, yPos, { width: 60 });
      doc.text('Clock Out', 310, yPos, { width: 60 });
      doc.text('Break', 370, yPos, { width: 40, align: 'right' });
      doc.text('Regular', 410, yPos, { width: 50, align: 'right' });
      doc.text('OT', 460, yPos, { width: 40, align: 'right' });
      doc.text('DT', 500, yPos, { width: 40, align: 'right' });
      doc.text('Total', 540, yPos, { width: 50, align: 'right' });
      doc.text('Pay', 590, yPos, { width: 60, align: 'right' });

      yPos += 4;
      doc.moveTo(40, yPos + 10).lineTo(750, yPos + 10).stroke('#ccc');
      yPos += 16;

      // Entries
      doc.font('Helvetica').fontSize(8);
      for (const entry of workerData.entries) {
        if (yPos > 540) {
          doc.addPage();
          yPos = 40;
        }

        const dateStr = new Date(entry.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        const clockInStr = new Date(entry.clockIn).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        const clockOutStr = entry.clockOut ? new Date(entry.clockOut).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '--';

        doc.fillColor('#000');
        doc.text(dateStr, 40, yPos, { width: 70 });
        doc.text(entry.job.substring(0, 22), 110, yPos, { width: 140 });
        doc.text(clockInStr, 250, yPos, { width: 60 });
        doc.text(clockOutStr, 310, yPos, { width: 60 });
        doc.text(`${entry.breakMinutes}m`, 370, yPos, { width: 40, align: 'right' });
        doc.text(entry.regularHours.toFixed(1), 410, yPos, { width: 50, align: 'right' });
        doc.text(entry.overtimeHours.toFixed(1), 460, yPos, { width: 40, align: 'right' });
        doc.text(entry.doubleTimeHours.toFixed(1), 500, yPos, { width: 40, align: 'right' });
        doc.text(entry.totalHours.toFixed(1), 540, yPos, { width: 50, align: 'right' });
        doc.text(`$${entry.pay.toFixed(2)}`, 590, yPos, { width: 60, align: 'right' });
        yPos += 14;
      }

      // Worker subtotal
      doc.moveTo(40, yPos).lineTo(750, yPos).stroke('#ccc');
      yPos += 6;
      doc.font('Helvetica-Bold');
      doc.text('Total', 40, yPos, { width: 70 });
      doc.text(workerData.totalRegularHours.toFixed(1), 410, yPos, { width: 50, align: 'right' });
      doc.text(workerData.totalOvertimeHours.toFixed(1), 460, yPos, { width: 40, align: 'right' });
      doc.text(workerData.totalDoubleTimeHours.toFixed(1), 500, yPos, { width: 40, align: 'right' });
      doc.text(workerData.totalHours.toFixed(1), 540, yPos, { width: 50, align: 'right' });
      doc.text(`$${workerData.totalPay.toFixed(2)}`, 590, yPos, { width: 60, align: 'right' });

      // Signature line
      yPos += 25;
      doc.font('Helvetica').fontSize(8).fillColor('#666');
      doc.text('Worker Signature: _______________________________', 40, yPos);
      doc.text('Date: _______________', 300, yPos);
      doc.text('Supervisor: _______________________________', 450, yPos);

      yPos += 35;
    }

    doc.end();

    return new Promise((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
    });
  }

  // ============================================
  // WH-347 CERTIFIED PAYROLL (Keep existing)
  // For prevailing wage projects
  // ============================================

  async getWH347Jobs(companyId: string) {
    return this.prisma.job.findMany({
      where: { companyId, isPrevailingWage: true, isActive: true },
      select: {
        id: true,
        name: true,
        address: true,
        city: true,
        state: true,
        projectNumber: true,
        wageDecisionNumber: true,
      },
      orderBy: { name: 'asc' },
    });
  }

  async previewWH347(companyId: string, jobId: string, weekEndingDate: Date) {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, companyId, isPrevailingWage: true },
    });

    if (!job) {
      throw new NotFoundException('Prevailing wage job not found');
    }

    // Calculate week start (Sunday) from week ending (Saturday)
    const weekEnd = new Date(weekEndingDate);
    weekEnd.setHours(23, 59, 59, 999);
    
    const weekStart = new Date(weekEnd);
    weekStart.setDate(weekStart.getDate() - 6);
    weekStart.setHours(0, 0, 0, 0);

    // Get approved entries for this job during the week
    const entries = await this.prisma.timeEntry.findMany({
      where: {
        companyId,
        jobId,
        approvalStatus: 'APPROVED',
        isArchived: false,
        clockOutTime: { not: null },
        clockInTime: { gte: weekStart, lte: weekEnd },
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            phone: true,
            hourlyRate: true,
            address: true,
            city: true,
            state: true,
            zipCode: true,
            lastFourSSN: true,
            tradeClassification: true,
          },
        },
      },
      orderBy: { clockInTime: 'asc' },
    });

    // Group by worker and calculate daily hours
    const workerMap: Record<string, {
      name: string;
      address: string;
      lastFourSSN: string;
      tradeClassification: string;
      hourlyRate: number;
      dailyHours: number[];
      totalHours: number;
      grossPay: number;
    }> = {};

    for (const entry of entries) {
      const wid = entry.userId;
      
      if (!workerMap[wid]) {
        const user = entry.user;
        const addressParts = [user?.address, user?.city, user?.state, user?.zipCode].filter(Boolean);
        
        workerMap[wid] = {
          name: user?.name || 'Unknown',
          address: addressParts.length > 0 ? addressParts.join(', ') : 'Address not provided',
          lastFourSSN: user?.lastFourSSN || 'XXXX',
          tradeClassification: user?.tradeClassification || '',
          hourlyRate: user?.hourlyRate ? Number(user.hourlyRate) : 0,
          dailyHours: [0, 0, 0, 0, 0, 0, 0], // Sun-Sat
          totalHours: 0,
          grossPay: 0,
        };
      }

      // Determine day of week (0 = Sunday)
      const entryDate = new Date(entry.clockInTime);
      const dayOfWeek = entryDate.getDay();
      
      const totalHrs = (entry.durationMinutes || 0) / 60;
      workerMap[wid].dailyHours[dayOfWeek] += totalHrs;
      workerMap[wid].totalHours += totalHrs;
      workerMap[wid].grossPay += entry.laborCost ? Number(entry.laborCost) : 0;
    }

    const workers = Object.values(workerMap);
    const totalGrossPay = workers.reduce((sum, w) => sum + w.grossPay, 0);

    return {
      job,
      weekEnding: weekEndingDate,
      weekStart,
      workers,
      entryCount: entries.length,
      totalGrossPay,
    };
  }

  async generateWH347(companyId: string, userId: string, jobId: string, weekEndingDate: Date) {
    const preview = await this.previewWH347(companyId, jobId, weekEndingDate);

    if (preview.workers.length === 0) {
      throw new BadRequestException('No approved entries found for this week');
    }

    // Get next payroll number
    const lastPayroll = await this.prisma.certifiedPayroll.findFirst({
      where: { companyId, jobId },
      orderBy: { payrollNumber: 'desc' },
    });

    const payrollNumber = (lastPayroll?.payrollNumber || 0) + 1;

    // Create certified payroll record
    const certifiedPayroll = await this.prisma.certifiedPayroll.create({
      data: {
        companyId,
        jobId,
        payrollNumber,
        weekEndingDate,
        status: 'DRAFT',
        workerData: preview.workers,
        totalGrossPay: preview.totalGrossPay,
        createdById: userId,
      },
      include: { job: true },
    });

    await this.auditService.log({
      companyId,
      userId,
      action: 'CERTIFIED_PAYROLL_GENERATED',
      targetType: 'CERTIFIED_PAYROLL',
      targetId: certifiedPayroll.id,
      details: {
        jobName: preview.job.name,
        weekEnding: weekEndingDate.toISOString(),
        workerCount: preview.workers.length,
        totalGrossPay: preview.totalGrossPay,
      },
    });

    return certifiedPayroll;
  }

  async generateWH347PDF(payrollId: string, companyId: string): Promise<Buffer> {
    const payroll = await this.prisma.certifiedPayroll.findFirst({
      where: { id: payrollId, companyId },
      include: { job: true, createdBy: true },
    });

    if (!payroll) {
      throw new NotFoundException('Certified payroll not found');
    }

    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
    });

    const doc = new PDFDocument({ size: 'LETTER', layout: 'landscape', margin: 30 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));

    // Header
    doc.fontSize(10).font('Helvetica-Bold').text('U.S. DEPARTMENT OF LABOR', 30, 20);
    doc.fontSize(14).text('PAYROLL', 30, 32);
    doc.fontSize(8).text('(WH-347)', 80, 34);

    // Company info
    doc.fontSize(9).font('Helvetica');
    doc.text(`NAME OF CONTRACTOR: ${company?.name || 'N/A'}`, 30, 55);
    doc.text(`ADDRESS: ${company?.address || 'N/A'}`, 30, 67);

    // Project info
    doc.text(`PAYROLL NO: ${payroll.payrollNumber}`, 400, 55);
    const weekEnd = new Date(payroll.weekEndingDate);
    doc.text(`FOR WEEK ENDING: ${weekEnd.toLocaleDateString()}`, 500, 55);
    
    const jobAddress = [payroll.job?.address, payroll.job?.city, payroll.job?.state].filter(Boolean).join(', ');
    doc.text(`PROJECT AND LOCATION: ${payroll.job?.name} - ${jobAddress || 'N/A'}`, 30, 85);
    doc.text(`PROJECT OR CONTRACT NO: ${payroll.job?.projectNumber || 'N/A'}`, 30, 97);
    doc.text(`WAGE DECISION NO: ${(payroll.job as any)?.wageDecisionNumber || 'N/A'}`, 300, 97);

    // Table header
    let yPos = 120;
    doc.fontSize(7).font('Helvetica-Bold');
    
    doc.rect(30, yPos, 732, 20).stroke();
    doc.text('Name, Address & SSN', 35, yPos + 6, { width: 180 });
    doc.text('Work\nClass', 220, yPos + 2, { width: 50 });
    
    // Days of week
    const days = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
    let dayX = 275;
    days.forEach((day, i) => {
      doc.text(day, dayX + (i * 25), yPos + 6, { width: 20, align: 'center' });
    });
    
    doc.text('Total\nHrs', 455, yPos + 2, { width: 35, align: 'center' });
    doc.text('Rate of\nPay', 495, yPos + 2, { width: 45, align: 'center' });
    doc.text('Gross', 545, yPos + 2, { width: 50, align: 'center' });
    doc.text('Ded.', 600, yPos + 2, { width: 40, align: 'center' });
    doc.text('Net Pay', 645, yPos + 2, { width: 55, align: 'center' });

    yPos += 20;

    // Workers
    const workers = (payroll.workerData as any[]) || [];
    doc.font('Helvetica').fontSize(7);

    for (const worker of workers) {
      if (yPos > 520) {
        doc.addPage();
        yPos = 30;
      }

      const rowHeight = 36;
      doc.rect(30, yPos, 732, rowHeight).stroke();

      // Name, address, SSN
      doc.text(worker.name, 35, yPos + 4, { width: 175 });
      doc.fontSize(6).text(worker.address.substring(0, 40), 35, yPos + 14, { width: 175 });
      doc.text(`XXX-XX-${worker.lastFourSSN}`, 35, yPos + 24, { width: 175 });
      doc.fontSize(7);

      // Trade
      doc.text(worker.tradeClassification || 'Laborer', 220, yPos + 12, { width: 50 });

      // Daily hours
      dayX = 275;
      worker.dailyHours.forEach((hrs: number, i: number) => {
        doc.text(hrs > 0 ? hrs.toFixed(1) : '-', dayX + (i * 25), yPos + 12, { width: 20, align: 'center' });
      });

      // Totals
      doc.text(worker.totalHours.toFixed(1), 455, yPos + 12, { width: 35, align: 'center' });
      doc.text(`$${worker.hourlyRate.toFixed(2)}`, 495, yPos + 12, { width: 45, align: 'center' });
      doc.text(`$${worker.grossPay.toFixed(2)}`, 545, yPos + 12, { width: 50, align: 'center' });
      doc.text('$0.00', 600, yPos + 12, { width: 40, align: 'center' });
      doc.text(`$${worker.grossPay.toFixed(2)}`, 645, yPos + 12, { width: 55, align: 'center' });

      yPos += rowHeight;
    }

    // Totals row
    doc.rect(30, yPos, 732, 20).fill('#f0f0f0').stroke();
    doc.fillColor('#000').font('Helvetica-Bold').fontSize(8);
    doc.text('TOTALS:', 35, yPos + 6);
    const totalGross = workers.reduce((sum, w) => sum + w.grossPay, 0);
    doc.text(`$${totalGross.toFixed(2)}`, 545, yPos + 6, { width: 50, align: 'center' });
    doc.text('$0.00', 600, yPos + 6, { width: 40, align: 'center' });
    doc.text(`$${totalGross.toFixed(2)}`, 645, yPos + 6, { width: 55, align: 'center' });

    // Certification statement
    yPos += 35;
    doc.font('Helvetica').fontSize(7);
    doc.text(
      'I, the undersigned, certify that the above payroll is correct and complete, that the wage rates contained therein are not less than those determined by the Secretary of Labor, and that each employee has been paid the full wages earned without any deductions or rebates except those authorized by law.',
      30, yPos, { width: 732 }
    );

    yPos += 30;
    doc.text('Signature ________________________________', 30, yPos);
    doc.text('Title ________________________________', 280, yPos);
    doc.text('Date ________________________________', 500, yPos);

    doc.end();

    return new Promise((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
    });
  }

  // ============================================
  // REPORT HISTORY
  // ============================================

  async getPayrollHistory(companyId: string) {
    return this.prisma.certifiedPayroll.findMany({
      where: { companyId },
      include: {
        job: { select: { id: true, name: true, projectNumber: true } },
        createdBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async submitPayroll(payrollId: string, companyId: string, userId: string) {
    const payroll = await this.prisma.certifiedPayroll.findFirst({
      where: { id: payrollId, companyId },
    });

    if (!payroll) {
      throw new NotFoundException('Certified payroll not found');
    }

    if (payroll.status === 'SUBMITTED') {
      throw new BadRequestException('Payroll already submitted');
    }

    return this.prisma.certifiedPayroll.update({
      where: { id: payrollId },
      data: {
        status: 'SUBMITTED',
        submittedAt: new Date(),
        submittedById: userId,
      },
    });
  }
}
