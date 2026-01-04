import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import * as PDFDocument from 'pdfkit';

interface WorkerPayrollData {
  name: string;
  address: string;
  lastFourSSN: string;
  tradeClassification: string;
  dailyHours: { [key: string]: number };
  totalHours: number;
  regularHours: number;
  overtimeHours: number;
  hourlyRate: number;
  grossPay: number;
  deductions: number;
  netPay: number;
}

@Injectable()
export class CertifiedPayrollService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
  ) {}

  async getPrevailingWageJobs(companyId: string) {
    return this.prisma.job.findMany({
      where: { companyId, isPrevailingWage: true, isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  async generatePayrollData(companyId: string, jobId: string, weekEndingDate: Date) {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, companyId, isPrevailingWage: true },
    });

    if (!job) {
      throw new NotFoundException('Prevailing wage job not found');
    }

    // Calculate week start (Saturday before week ending)
    const weekEnding = new Date(weekEndingDate);
    const weekStart = new Date(weekEnding);
    weekStart.setDate(weekStart.getDate() - 6);
    weekStart.setHours(0, 0, 0, 0);
    weekEnding.setHours(23, 59, 59, 999);

    // Get all approved time entries for this job during the week
    const timeEntries = await this.prisma.timeEntry.findMany({
      where: {
        companyId,
        jobId,
        approvalStatus: 'APPROVED',
        clockOutTime: { not: null },
        clockInTime: {
          gte: weekStart,
          lte: weekEnding,
        },
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            address: true,
            city: true,
            state: true,
            zip: true,
            lastFourSSN: true,
            tradeClassification: true,
          },
        },
      },
      orderBy: { clockInTime: 'asc' },
    });

    // Group by worker and calculate daily hours
    const workerData: { [userId: string]: WorkerPayrollData } = {};
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    for (const entry of timeEntries) {
      const userId = entry.userId;
      const dayOfWeek = new Date(entry.clockInTime).getDay();
      const dayName = dayNames[dayOfWeek];
      const hours = (entry.durationMinutes || 0) / 60;

      if (!workerData[userId]) {
        const user = entry.user;
        const fullAddress = [user.address, user.city, user.state, user.zip]
          .filter(Boolean)
          .join(', ');

        workerData[userId] = {
          name: user.name,
          address: fullAddress || 'Address not provided',
          lastFourSSN: user.lastFourSSN || 'XXXX',
          tradeClassification: user.tradeClassification || 'Laborer',
          dailyHours: { Sun: 0, Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0 },
          totalHours: 0,
          regularHours: 0,
          overtimeHours: 0,
          hourlyRate: entry.hourlyRate ? Number(entry.hourlyRate) : 0,
          grossPay: 0,
          deductions: 0,
          netPay: 0,
        };
      }

      workerData[userId].dailyHours[dayName] += hours;
      workerData[userId].totalHours += hours;
      workerData[userId].regularHours += (entry.regularMinutes || 0) / 60;
      workerData[userId].overtimeHours += ((entry.overtimeMinutes || 0) + (entry.doubleTimeMinutes || 0)) / 60;
      workerData[userId].grossPay += entry.laborCost ? Number(entry.laborCost) : 0;
    }

    // Calculate net pay (gross - deductions, simplified)
    for (const userId in workerData) {
      workerData[userId].netPay = workerData[userId].grossPay - workerData[userId].deductions;
    }

    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
    });

    return {
      job,
      company,
      weekStart,
      weekEnding: weekEndingDate,
      workers: Object.values(workerData),
      totalGrossPay: Object.values(workerData).reduce((sum, w) => sum + w.grossPay, 0),
      entryCount: timeEntries.length,
    };
  }

  async createOrUpdatePayroll(companyId: string, jobId: string, weekEndingDate: Date, userId: string) {
    const payrollData = await this.generatePayrollData(companyId, jobId, weekEndingDate);

    // Get next payroll number for this job
    const existingPayrolls = await this.prisma.certifiedPayroll.count({
      where: { companyId, jobId },
    });

    const existing = await this.prisma.certifiedPayroll.findFirst({
      where: {
        companyId,
        jobId,
        weekEndingDate: weekEndingDate,
      },
    });

    let payroll;
    if (existing) {
      payroll = await this.prisma.certifiedPayroll.update({
        where: { id: existing.id },
        data: {
          reportData: payrollData as any,
          status: 'DRAFT',
        },
      });
    } else {
      payroll = await this.prisma.certifiedPayroll.create({
        data: {
          companyId,
          jobId,
          weekEndingDate,
          payrollNumber: existingPayrolls + 1,
          reportData: payrollData as any,
          status: 'DRAFT',
        },
      });
    }

    await this.auditService.log({
      companyId,
      userId,
      action: 'CERTIFIED_PAYROLL_GENERATED' as any,
      targetType: 'CERTIFIED_PAYROLL',
      targetId: payroll.id,
      details: {
        jobName: payrollData.job.name,
        weekEnding: weekEndingDate,
        workerCount: payrollData.workers.length,
        totalGrossPay: payrollData.totalGrossPay,
      },
    });

    return payroll;
  }

  async getPayrolls(companyId: string, filters?: { jobId?: string; status?: string }) {
    const where: any = { companyId };
    if (filters?.jobId) where.jobId = filters.jobId;
    if (filters?.status) where.status = filters.status;

    return this.prisma.certifiedPayroll.findMany({
      where,
      include: {
        job: { select: { id: true, name: true, projectNumber: true } },
      },
      orderBy: { weekEndingDate: 'desc' },
    });
  }

  async getPayrollById(companyId: string, payrollId: string) {
    const payroll = await this.prisma.certifiedPayroll.findFirst({
      where: { id: payrollId, companyId },
      include: {
        job: true,
        company: true,
      },
    });

    if (!payroll) {
      throw new NotFoundException('Payroll not found');
    }

    return payroll;
  }

  async submitPayroll(companyId: string, payrollId: string, userId: string) {
    const payroll = await this.getPayrollById(companyId, payrollId);

    if (payroll.status === 'SUBMITTED') {
      throw new BadRequestException('Payroll already submitted');
    }

    const updated = await this.prisma.certifiedPayroll.update({
      where: { id: payrollId },
      data: {
        status: 'SUBMITTED',
        submittedAt: new Date(),
        submittedBy: userId,
      },
    });

    await this.auditService.log({
      companyId,
      userId,
      action: 'CERTIFIED_PAYROLL_SUBMITTED' as any,
      targetType: 'CERTIFIED_PAYROLL',
      targetId: payrollId,
      details: {
        jobName: payroll.job.name,
        weekEnding: payroll.weekEndingDate,
      },
    });

    return updated;
  }

  async generatePDF(companyId: string, payrollId: string): Promise<Buffer> {
    const payroll = await this.getPayrollById(companyId, payrollId);
    const data = payroll.reportData as any;

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'LETTER', layout: 'landscape', margin: 30 });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Header
      doc.fontSize(14).font('Helvetica-Bold').text('U.S. DEPARTMENT OF LABOR', { align: 'center' });
      doc.fontSize(12).text('PAYROLL', { align: 'center' });
      doc.fontSize(10).font('Helvetica').text('(WH-347)', { align: 'center' });
      doc.moveDown();

      // Project Info
      const leftCol = 30;
      const rightCol = 400;
      
      doc.fontSize(9).font('Helvetica-Bold');
      doc.text('NAME OF CONTRACTOR OR SUBCONTRACTOR:', leftCol, doc.y);
      doc.font('Helvetica').text(data.company?.name || 'N/A', leftCol + 220, doc.y - 10);
      
      doc.moveDown(0.5);
      doc.font('Helvetica-Bold').text('ADDRESS:', leftCol);
      const companyAddress = [data.company?.address, data.company?.city, data.company?.state, data.company?.zip]
        .filter(Boolean).join(', ');
      doc.font('Helvetica').text(companyAddress || 'N/A', leftCol + 60, doc.y - 10);

      doc.moveDown(0.5);
      doc.font('Helvetica-Bold').text('PAYROLL NO:', leftCol);
      doc.font('Helvetica').text(String(payroll.payrollNumber), leftCol + 80, doc.y - 10);

      doc.font('Helvetica-Bold').text('FOR WEEK ENDING:', rightCol, doc.y - 10);
      doc.font('Helvetica').text(new Date(payroll.weekEndingDate).toLocaleDateString(), rightCol + 120, doc.y - 10);

      doc.moveDown(0.5);
      doc.font('Helvetica-Bold').text('PROJECT AND LOCATION:', leftCol);
      doc.font('Helvetica').text(`${data.job?.name || 'N/A'} - ${data.job?.address || 'N/A'}`, leftCol + 140, doc.y - 10);

      doc.moveDown(0.5);
      doc.font('Helvetica-Bold').text('PROJECT OR CONTRACT NO:', leftCol);
      doc.font('Helvetica').text(data.job?.projectNumber || 'N/A', leftCol + 160, doc.y - 10);

      doc.moveDown(1.5);

      // Table Header
      const tableTop = doc.y;
      const colWidths = [120, 80, 40, 28, 28, 28, 28, 28, 28, 28, 40, 40, 50, 50, 50, 50];
      const headers = ['Name/Address/SSN', 'Classification', 'S', 'M', 'T', 'W', 'T', 'F', 'S', 'Hrs', 'Rate', 'Gross', 'Ded.', 'Net'];
      
      let xPos = leftCol;
      doc.fontSize(7).font('Helvetica-Bold');
      
      headers.forEach((header, i) => {
        doc.text(header, xPos, tableTop, { width: colWidths[i], align: 'center' });
        xPos += colWidths[i];
      });

      doc.moveTo(leftCol, tableTop + 12).lineTo(750, tableTop + 12).stroke();

      // Table Rows
      let yPos = tableTop + 18;
      doc.font('Helvetica').fontSize(7);

      const workers = data.workers || [];
      workers.forEach((worker: WorkerPayrollData, index: number) => {
        if (yPos > 520) {
          doc.addPage();
          yPos = 50;
        }

        xPos = leftCol;
        
        // Name, Address, SSN (stacked)
        doc.text(worker.name, xPos, yPos, { width: colWidths[0] });
        doc.fontSize(6).text(`XXX-XX-${worker.lastFourSSN}`, xPos, yPos + 8, { width: colWidths[0] });
        doc.fontSize(7);
        xPos += colWidths[0];

        // Classification
        doc.text(worker.tradeClassification, xPos, yPos, { width: colWidths[1], align: 'center' });
        xPos += colWidths[1];

        // Work classification (O/S/H = Other/Straight/Holiday)
        doc.text('S', xPos, yPos, { width: colWidths[2], align: 'center' });
        xPos += colWidths[2];

        // Daily hours
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        days.forEach((day, i) => {
          const hrs = worker.dailyHours[day] || 0;
          doc.text(hrs > 0 ? hrs.toFixed(1) : '-', xPos, yPos, { width: colWidths[3 + i], align: 'center' });
          xPos += colWidths[3 + i];
        });

        // Total hours
        doc.text(worker.totalHours.toFixed(1), xPos, yPos, { width: colWidths[10], align: 'center' });
        xPos += colWidths[10];

        // Rate
        doc.text(`$${worker.hourlyRate.toFixed(2)}`, xPos, yPos, { width: colWidths[11], align: 'center' });
        xPos += colWidths[11];

        // Gross
        doc.text(`$${worker.grossPay.toFixed(2)}`, xPos, yPos, { width: colWidths[12], align: 'center' });
        xPos += colWidths[12];

        // Deductions
        doc.text(`$${worker.deductions.toFixed(2)}`, xPos, yPos, { width: colWidths[13], align: 'center' });
        xPos += colWidths[13];

        // Net
        doc.text(`$${worker.netPay.toFixed(2)}`, xPos, yPos, { width: colWidths[14], align: 'center' });

        yPos += 20;
      });

      // Totals row
      doc.moveTo(leftCol, yPos).lineTo(750, yPos).stroke();
      yPos += 5;
      
      const totalGross = workers.reduce((sum: number, w: WorkerPayrollData) => sum + w.grossPay, 0);
      const totalNet = workers.reduce((sum: number, w: WorkerPayrollData) => sum + w.netPay, 0);
      
      doc.font('Helvetica-Bold');
      doc.text('TOTALS:', leftCol, yPos);
      doc.text(`$${totalGross.toFixed(2)}`, leftCol + 490, yPos);
      doc.text(`$${totalNet.toFixed(2)}`, leftCol + 590, yPos);

      // Certification section
      yPos += 40;
      doc.font('Helvetica').fontSize(8);
      doc.text('I certify that the above payroll is correct and complete, and that each employee has been paid the full wages earned ' +
        'without any deductions or rebates except those authorized by law.', leftCol, yPos, { width: 700 });

      yPos += 40;
      doc.text('Signature: _________________________________', leftCol, yPos);
      doc.text('Title: _________________________________', leftCol + 300, yPos);
      doc.text('Date: _________________________________', leftCol + 500, yPos);

      doc.end();
    });
  }
}
