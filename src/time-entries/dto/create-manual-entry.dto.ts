import { IsString, IsOptional, IsNumber, IsDateString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateManualEntryDto {
  @ApiProperty({ description: 'Worker ID' })
  @IsString()
  userId: string;

  @ApiPropertyOptional({ description: 'Job ID' })
  @IsString()
  @IsOptional()
  jobId?: string;

  @ApiProperty({ description: 'Date (YYYY-MM-DD)' })
  @IsDateString()
  date: string;

  @ApiProperty({ description: 'Clock in time (HH:MM)' })
  @IsString()
  clockIn: string;

  @ApiProperty({ description: 'Clock out time (HH:MM)' })
  @IsString()
  clockOut: string;

  @ApiPropertyOptional({ description: 'Break minutes' })
  @IsNumber()
  @IsOptional()
  breakMinutes?: number;

  @ApiPropertyOptional({ description: 'Notes' })
  @IsString()
  @IsOptional()
  notes?: string;
}
