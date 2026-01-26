import { IsString, IsOptional, IsDateString, IsArray, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTimesheetDto {
  @ApiPropertyOptional({ description: 'Start date of the period (legacy, optional if entryIds provided)' })
  @IsDateString()
  @IsOptional()
  periodStart?: string;

  @ApiPropertyOptional({ description: 'End date of the period (legacy, optional if entryIds provided)' })
  @IsDateString()
  @IsOptional()
  periodEnd?: string;

  @ApiPropertyOptional({ description: 'Specific entry IDs to include in timesheet' })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  entryIds?: string[];

  @ApiPropertyOptional({ description: 'Optional name for the timesheet' })
  @IsString()
  @IsOptional()
  name?: string;
}

export class UpdateTimesheetDto {
  @ApiPropertyOptional({ description: 'Entry IDs to include (replaces current entries)' })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  entryIds?: string[];

  @ApiPropertyOptional({ description: 'Optional name for the timesheet' })
  @IsString()
  @IsOptional()
  name?: string;
}

export class SubmitTimesheetDto {
  @ApiProperty()
  @IsString()
  timesheetId: string;
}

export class ReviewTimesheetDto {
  @ApiProperty({ enum: ['APPROVED', 'REJECTED'] })
  @IsEnum(['APPROVED', 'REJECTED'])
  status: 'APPROVED' | 'REJECTED';

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  notes?: string;
}
