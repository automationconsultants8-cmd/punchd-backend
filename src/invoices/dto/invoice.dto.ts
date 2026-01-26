import { IsString, IsOptional, IsNumber, IsDateString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateInvoiceDto {
  @ApiProperty({ description: 'Timesheet ID to invoice' })
  @IsString()
  timesheetId: string;

  @ApiProperty({ description: 'Invoice number' })
  @IsString()
  invoiceNumber: string;

  @ApiProperty({ description: 'Due date' })
  @IsDateString()
  dueDate: string;

  @ApiProperty({ description: 'Hourly rate' })
  @IsNumber()
  hourlyRate: number;

  @ApiPropertyOptional({ description: 'Notes' })
  @IsString()
  @IsOptional()
  notes?: string;
}

export class UpdateInvoiceStatusDto {
  @ApiProperty({ enum: ['PENDING', 'PAID', 'OVERDUE', 'CANCELLED'] })
  @IsString()
  status: 'PENDING' | 'PAID' | 'OVERDUE' | 'CANCELLED';

  @ApiPropertyOptional({ description: 'Payment method (for PAID status)' })
  @IsString()
  @IsOptional()
  paymentMethod?: string;

  @ApiPropertyOptional({ description: 'Payment notes' })
  @IsString()
  @IsOptional()
  paymentNotes?: string;

  @ApiPropertyOptional({ description: 'Amount paid (defaults to total)' })
  @IsNumber()
  @IsOptional()
  paidAmount?: number;
}
