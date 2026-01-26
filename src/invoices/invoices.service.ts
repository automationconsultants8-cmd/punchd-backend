import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateInvoiceDto, UpdateInvoiceStatusDto } from './dto/invoice.dto';

@Injectable()
export class InvoicesService {
  constructor(private prisma: PrismaService) {}

  // Get all invoices for a contractor
  async getMyInvoices(userId: string, companyId: string) {
    return this.prisma.invoice.findMany({
      where: { userId, companyId },
      include: {
        timesheet: {
          select: {
            id: true,
            periodStart: true,
            periodEnd: true,
            totalMinutes: true,
            name: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Get invoice by ID
  async getById(id: string, userId: string, companyId: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, companyId },
      include: {
        timesheet: {
          include: {
            entries: {
              select: {
                id: true,
                clockInTime: true,
                clockOutTime: true,
                durationMinutes: true,
                job: { select: { name: true } },
              },
            },
          },
        },
        user: {
          select: { id: true, name: true, email: true, phone: true, address: true, city: true, state: true, zip: true },
        },
      },
    });

    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    // Contractors can only see their own invoices
    if (invoice.userId !== userId) {
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (user?.role === 'WORKER') {
        throw new ForbiddenException('Access denied');
      }
    }

    return invoice;
  }

  // Create an invoice from an approved timesheet
  async create(userId: string, companyId: string, dto: CreateInvoiceDto) {
    // Verify the timesheet exists, is approved, and belongs to user
    const timesheet = await this.prisma.timesheet.findFirst({
      where: {
        id: dto.timesheetId,
        userId,
        companyId,
        status: 'APPROVED',
      },
    });

    if (!timesheet) {
      throw new BadRequestException('Timesheet not found or not approved');
    }

    // Check if already invoiced
    const existingInvoice = await this.prisma.invoice.findUnique({
      where: { timesheetId: dto.timesheetId },
    });

    if (existingInvoice) {
      throw new BadRequestException('This timesheet has already been invoiced');
    }

    // Check invoice number uniqueness
    const existingNumber = await this.prisma.invoice.findFirst({
      where: { companyId, invoiceNumber: dto.invoiceNumber },
    });

    if (existingNumber) {
      throw new BadRequestException('Invoice number already exists');
    }

    // Calculate totals
    const totalHours = (timesheet.totalMinutes || 0) / 60;
    const totalAmount = totalHours * dto.hourlyRate;

    const invoice = await this.prisma.invoice.create({
      data: {
        companyId,
        userId,
        timesheetId: dto.timesheetId,
        invoiceNumber: dto.invoiceNumber,
        dueDate: new Date(dto.dueDate),
        hourlyRate: dto.hourlyRate,
        totalHours,
        totalAmount,
        notes: dto.notes,
        status: 'PENDING',
      },
      include: {
        timesheet: {
          select: {
            id: true,
            periodStart: true,
            periodEnd: true,
            totalMinutes: true,
          },
        },
      },
    });

    return invoice;
  }

  // Admin: Get all invoices for company
  async getAllForCompany(companyId: string, status?: string) {
    const where: any = { companyId };
    if (status) {
      where.status = status;
    }

    return this.prisma.invoice.findMany({
      where,
      include: {
        user: {
          select: { id: true, name: true, email: true, phone: true },
        },
        timesheet: {
          select: {
            id: true,
            periodStart: true,
            periodEnd: true,
            totalMinutes: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Admin: Update invoice status (mark as paid, etc.)
  async updateStatus(invoiceId: string, companyId: string, dto: UpdateInvoiceStatusDto) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, companyId },
    });

    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    const updateData: any = {
      status: dto.status,
    };

    if (dto.status === 'PAID') {
      updateData.paidAt = new Date();
      updateData.paidAmount = dto.paidAmount || invoice.totalAmount;
      updateData.paymentMethod = dto.paymentMethod;
      updateData.paymentNotes = dto.paymentNotes;
    }

    return this.prisma.invoice.update({
      where: { id: invoiceId },
      data: updateData,
      include: {
        user: { select: { id: true, name: true } },
        timesheet: { select: { periodStart: true, periodEnd: true } },
      },
    });
  }

  // Generate PDF (placeholder - would need PDF library)
  async generatePdf(invoiceId: string, userId: string, companyId: string) {
    const invoice = await this.getById(invoiceId, userId, companyId);
    
    // For now, return invoice data that could be used to generate PDF
    // In production, you'd use a library like PDFKit or puppeteer
    return {
      invoice,
      message: 'PDF generation not yet implemented',
    };
  }
}
