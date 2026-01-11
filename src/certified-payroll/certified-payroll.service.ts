import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import * as PDFDocument from 'pdfkit';

export interface WorkerPayrollData {
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

export interface PayrollPreviewData {
  job: any;
  company: any;
  weekStart: Date;
  weekEnding: Date;
  workers: WorkerPayrollData[];
  totalGrossPay: number;
  entryCount: number;
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

  async generatePayrollData(companyId: string, jobId: string, weekEndingDateInput: Date | string): Promise<PayrollPreviewData> {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, companyId, isPrevailingWage: true },
    });

    if (!job) {
      throw new NotFoundException('Prevailing wage job not found');
    }

    // Parse the date properly
    let weekEndingDate: Date;
    if (typeof weekEndingDateInput === 'string') {
      // Handle string date input - add time to avoid timezone issues
      weekEndingDate = new Date(weekEndingDateInput + 'T12:00:00Z');
    } else {
      weekEndingDate = new Date(weekEndingDateInput);
    }

    if (isNaN(weekEndingDate.getTime())) {
      throw new BadRequestException('Invalid week ending date');
    }

    const weekEnding = new Date(weekEndingDate);
    const weekStart = new Date(weekEnding);
    weekStart.setDate(weekStart.getDate() - 6);
    weekStart.setHours(0, 0, 0, 0);
    weekEnding.setHours(23, 59, 59, 999);

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

    const workerData: { [userId: string]: WorkerPayrollData } = {};
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    for (const entry of timeEntries) {
      const userId = entry.userId;
      const dayOfWeek = new Date(entry.clockInTime).getDay();
      const dayName = dayNames[dayOfWeek];
      const hours = (entry.durationMinutes || 0) / 60;

      if (!workerData[userId]) {
        const user = entry.user;
        const addressParts = [user.address, user.city, user.state, user.zip].filter(Boolean);
        const fullAddress = addressParts.length > 0 ? addressParts.join(', ') : 'Address not provided';

        workerData[userId] = {
          name: user.name,
          address: fullAddress,
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

  async createOrUpdatePayroll(companyId: string, jobId: string, weekEndingDateInput: Date | string, userId: string) {
    // Parse the date properly
    let weekEndingDate: Date;
    if (typeof weekEndingDateInput === 'string') {
      weekEndingDate = new Date(weekEndingDateInput + 'T12:00:00Z');
    } else {
      weekEndingDate = new Date(weekEndingDateInput);
    }

    if (isNaN(weekEndingDate.getTime())) {
      throw new BadRequestException('Invalid week ending date');
    }

    const payrollData = await this.generatePayrollData(companyId, jobId, weekEndingDate);

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
      const doc = new PDFDocument({ 
        size: 'LETTER', 
        layout: 'landscape', 
        margins: { top: 40, bottom: 40, left: 40, right: 40 } 
      });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const pageWidth = 792; // Letter landscape
      const leftMargin = 40;
      const rightMargin = 752;
      const contentWidth = rightMargin - leftMargin;

      // === HEADER ===
      doc.fontSize(16).font('Helvetica-Bold').text('U.S. DEPARTMENT OF LABOR', leftMargin, 40, { align: 'center', width: contentWidth });
      doc.fontSize(14).text('PAYROLL', { align: 'center', width: contentWidth });
      doc.fontSize(10).font('Helvetica').text('(WH-347)', { align: 'center', width: contentWidth });
      doc.moveDown(1.5);

      // === PROJECT INFO BOX ===
      const infoStartY = doc.y;
      doc.rect(leftMargin, infoStartY, contentWidth, 100).stroke();

      // Left column
      const col1X = leftMargin + 10;
      const col2X = leftMargin + 180;
      const col3X = leftMargin + 450;
      const col4X = leftMargin + 560;
      let infoY = infoStartY + 10;

      // Company info
      const companyAddress = [data.company?.address, data.company?.city, data.company?.state, data.company?.zip]
        .filter(Boolean).join(', ') || 'N/A';

      doc.fontSize(8).font('Helvetica-Bold').text('NAME OF CONTRACTOR:', col1X, infoY);
      doc.font('Helvetica').text(data.company?.name || 'N/A', col2X, infoY);

      infoY += 14;
      doc.font('Helvetica-Bold').text('ADDRESS:', col1X, infoY);
      doc.font('Helvetica').text(companyAddress, col2X, infoY, { width: 250 });

      infoY += 14;
      doc.font('Helvetica-Bold').text('PAYROLL NO:', col1X, infoY);
      doc.font('Helvetica').text(String(payroll.payrollNumber), col2X, infoY);

      doc.font('Helvetica-Bold').text('FOR WEEK ENDING:', col3X, infoY);
      doc.font('Helvetica').text(new Date(payroll.weekEndingDate).toLocaleDateString('en-US'), col4X, infoY);

      infoY += 14;
      doc.font('Helvetica-Bold').text('PROJECT AND LOCATION:', col1X, infoY);
      doc.font('Helvetica').text(`${data.job?.name || 'N/A'} - ${data.job?.address || 'N/A'}`, col2X, infoY, { width: 400 });

      infoY += 14;
      doc.font('Helvetica-Bold').text('PROJECT OR CONTRACT NO:', col1X, infoY);
      doc.font('Helvetica').text(data.job?.projectNumber || 'N/A', col2X, infoY);

      doc.font('Helvetica-Bold').text('WAGE DECISION NO:', col3X, infoY);
      doc.font('Helvetica').text(data.job?.wageDecisionNumber || 'N/A', col4X, infoY);

      // === TABLE ===
      const tableStartY = infoStartY + 115;
      
      // Column definitions
      const cols = [
        { header: 'Name, Address & SSN', width: 140, align: 'left' },
        { header: 'Work\nClass', width: 45, align: 'center' },
        { header: 'S', width: 32, align: 'center' },
        { header: 'M', width: 32, align: 'center' },
        { header: 'T', width: 32, align: 'center' },
        { header: 'W', width: 32, align: 'center' },
        { header: 'T', width: 32, align: 'center' },
        { header: 'F', width: 32, align: 'center' },
        { header: 'S', width: 32, align: 'center' },
        { header: 'Total\nHrs', width: 40, align: 'center' },
        { header: 'Rate of\nPay', width: 55, align: 'right' },
        { header: 'Gross', width: 65, align: 'right' },
        { header: 'Ded.', width: 50, align: 'right' },
        { header: 'Net Pay', width: 65, align: 'right' },
      ];

      // Draw table header
      let xPos = leftMargin;
      const headerHeight = 28;
      
      doc.rect(leftMargin, tableStartY, contentWidth, headerHeight).fillAndStroke('#f0f0f0', '#000');
      
      xPos = leftMargin;
      doc.fillColor('#000').fontSize(7).font('Helvetica-Bold');
      
      cols.forEach((col) => {
        doc.text(col.header, xPos + 3, tableStartY + 6, { 
          width: col.width - 6, 
          align: col.align as any,
          lineGap: 1
        });
        xPos += col.width;
      });

      // Draw vertical lines for header
      xPos = leftMargin;
      cols.forEach((col) => {
        doc.moveTo(xPos, tableStartY).lineTo(xPos, tableStartY + headerHeight).stroke();
        xPos += col.width;
      });
      doc.moveTo(xPos, tableStartY).lineTo(xPos, tableStartY + headerHeight).stroke();

      // Draw data rows
      let rowY = tableStartY + headerHeight;
      const rowHeight = 36;
      const workers = data.workers || [];

      doc.font('Helvetica').fontSize(7).fillColor('#000');

      workers.forEach((worker: WorkerPayrollData) => {
        // Draw row background (alternating)
        doc.rect(leftMargin, rowY, contentWidth, rowHeight).stroke();

        xPos = leftMargin;

        // Name, Address, SSN column
        doc.fontSize(8).font('Helvetica-Bold').text(worker.name, xPos + 3, rowY + 4, { width: cols[0].width - 6 });
        doc.fontSize(6).font('Helvetica').text(worker.address, xPos + 3, rowY + 14, { width: cols[0].width - 6 });
        doc.text(`XXX-XX-${worker.lastFourSSN}`, xPos + 3, rowY + 24, { width: cols[0].width - 6 });
        xPos += cols[0].width;

        // Classification
        doc.fontSize(7).text(worker.tradeClassification, xPos + 2, rowY + 12, { width: cols[1].width - 4, align: 'center' });
        xPos += cols[1].width;

        // Daily hours
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        days.forEach((day, i) => {
          const hrs = worker.dailyHours[day] || 0;
          doc.text(hrs > 0 ? hrs.toFixed(1) : '-', xPos + 2, rowY + 12, { width: cols[2 + i].width - 4, align: 'center' });
          xPos += cols[2 + i].width;
        });

        // Total hours
        doc.font('Helvetica-Bold').text(worker.totalHours.toFixed(1), xPos + 2, rowY + 12, { width: cols[9].width - 4, align: 'center' });
        xPos += cols[9].width;

        // Rate
        doc.font('Helvetica').text(`$${worker.hourlyRate.toFixed(2)}`, xPos + 2, rowY + 12, { width: cols[10].width - 4, align: 'right' });
        xPos += cols[10].width;

        // Gross
        doc.font('Helvetica-Bold').text(`$${worker.grossPay.toFixed(2)}`, xPos + 2, rowY + 12, { width: cols[11].width - 4, align: 'right' });
        xPos += cols[11].width;

        // Deductions
        doc.font('Helvetica').text(`$${worker.deductions.toFixed(2)}`, xPos + 2, rowY + 12, { width: cols[12].width - 4, align: 'right' });
        xPos += cols[12].width;

        // Net
        doc.font('Helvetica-Bold').text(`$${worker.netPay.toFixed(2)}`, xPos + 2, rowY + 12, { width: cols[13].width - 4, align: 'right' });

        // Draw vertical lines
        xPos = leftMargin;
        cols.forEach((col) => {
          doc.moveTo(xPos, rowY).lineTo(xPos, rowY + rowHeight).stroke();
          xPos += col.width;
        });
        doc.moveTo(xPos, rowY).lineTo(xPos, rowY + rowHeight).stroke();

        rowY += rowHeight;
      });

      // Totals row
      const totalsHeight = 24;
      doc.rect(leftMargin, rowY, contentWidth, totalsHeight).fillAndStroke('#f5f5f5', '#000');

      const totalGross = workers.reduce((sum: number, w: WorkerPayrollData) => sum + w.grossPay, 0);
      const totalDed = workers.reduce((sum: number, w: WorkerPayrollData) => sum + w.deductions, 0);
      const totalNet = workers.reduce((sum: number, w: WorkerPayrollData) => sum + w.netPay, 0);

      doc.fillColor('#000').font('Helvetica-Bold').fontSize(8);
      doc.text('TOTALS:', leftMargin + 5, rowY + 7);

      // Position for totals
      let totalsX = leftMargin;
      for (let i = 0; i < 11; i++) totalsX += cols[i].width;
      
      doc.text(`$${totalGross.toFixed(2)}`, totalsX + 2, rowY + 7, { width: cols[11].width - 4, align: 'right' });
      totalsX += cols[11].width;
      doc.text(`$${totalDed.toFixed(2)}`, totalsX + 2, rowY + 7, { width: cols[12].width - 4, align: 'right' });
      totalsX += cols[12].width;
      doc.text(`$${totalNet.toFixed(2)}`, totalsX + 2, rowY + 7, { width: cols[13].width - 4, align: 'right' });

      rowY += totalsHeight;

      // === CERTIFICATION ===
      rowY += 20;
      doc.font('Helvetica').fontSize(8).fillColor('#000');
      doc.text(
        'I, the undersigned, certify that the above payroll is correct and complete, that the wage rates contained therein are not less than those determined by the Secretary of Labor, and that each employee has been paid the full wages earned without any deductions or rebates except those authorized by law.',
        leftMargin, rowY, { width: contentWidth, align: 'justify' }
      );

      rowY += 50;
      
      // Signature lines
      const sigWidth = 200;
      const sigGap = 70;
      
      doc.moveTo(leftMargin, rowY).lineTo(leftMargin + sigWidth, rowY).stroke();
      doc.fontSize(8).text('Signature', leftMargin, rowY + 3);

      doc.moveTo(leftMargin + sigWidth + sigGap, rowY).lineTo(leftMargin + sigWidth * 2 + sigGap, rowY).stroke();
      doc.text('Title', leftMargin + sigWidth + sigGap, rowY + 3);

      doc.moveTo(leftMargin + sigWidth * 2 + sigGap * 2, rowY).lineTo(leftMargin + sigWidth * 3 + sigGap * 2, rowY).stroke();
      doc.text('Date', leftMargin + sigWidth * 2 + sigGap * 2, rowY + 3);

      doc.end();
    });
  }
}
