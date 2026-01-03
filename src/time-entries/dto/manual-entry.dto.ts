import { IsString, IsOptional, IsNumber, IsDateString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ManualTimeEntryDto {
  @ApiProperty({ description: 'Worker ID' })
  @IsString()
  userId: string;

  @ApiProperty({ description: 'Job ID' })
  @IsString()
  jobId: string;

  @ApiProperty({ description: 'Date of the entry (YYYY-MM-DD)' })
  @IsString()
  date: string;

  @ApiProperty({ description: 'Clock in time (HH:MM)' })
  @IsString()
  clockIn: string;

  @ApiProperty({ description: 'Clock out time (HH:MM)' })
  @IsString()
  clockOut: string;

  @ApiPropertyOptional({ description: 'Break duration in minutes' })
  @IsNumber()
  @IsOptional()
  breakMinutes?: number;

  @ApiPropertyOptional({ description: 'Notes for this entry' })
  @IsString()
  @IsOptional()
  notes?: string;
}
