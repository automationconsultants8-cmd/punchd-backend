import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { InvoicesService } from './invoices.service';
import { CreateInvoiceDto, UpdateInvoiceStatusDto } from './dto/invoice.dto';

@ApiTags('Invoices')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  // Contractor endpoints
  @Get('mine')
  @ApiOperation({ summary: 'Get my invoices' })
  getMyInvoices(@Request() req) {
    return this.invoicesService.getMyInvoices(req.user.userId, req.user.companyId);
  }

  @Post()
  @ApiOperation({ summary: 'Create an invoice from approved timesheet' })
  create(@Request() req, @Body() dto: CreateInvoiceDto) {
    return this.invoicesService.create(req.user.userId, req.user.companyId, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get invoice by ID' })
  getById(@Request() req, @Param('id') id: string) {
    return this.invoicesService.getById(id, req.user.userId, req.user.companyId);
  }

  @Get(':id/pdf')
  @ApiOperation({ summary: 'Download invoice PDF' })
  downloadPdf(@Request() req, @Param('id') id: string) {
    return this.invoicesService.generatePdf(id, req.user.userId, req.user.companyId);
  }

  // Admin endpoints
  @Get()
  @ApiOperation({ summary: 'Get all invoices (admin)' })
  getAll(@Request() req, @Query('status') status?: string) {
    return this.invoicesService.getAllForCompany(req.user.companyId, status);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update invoice status (admin)' })
  updateStatus(@Request() req, @Param('id') id: string, @Body() dto: UpdateInvoiceStatusDto) {
    return this.invoicesService.updateStatus(id, req.user.companyId, dto);
  }
}
