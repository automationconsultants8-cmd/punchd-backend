import { IsString, IsOptional, IsNumber, IsDateString, Min, Max, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

enum WorkerType {
  HOURLY = 'HOURLY',
  SALARIED = 'SALARIED',
  CONTRACTOR = 'CONTRACTOR',
  VOLUNTEER = 'VOLUNTEER',
}

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

  @ApiPropertyOptional({ description: 'Meal break minutes' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(480)
  breakMinutes?: number;

  @ApiPropertyOptional({ description: 'Number of 10-minute rest breaks taken' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(10)
  restBreaksTaken?: number;

  @ApiPropertyOptional({ description: 'Notes' })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiPropertyOptional({ description: 'Timezone (e.g. America/Los_Angeles)' })
  @IsString()
  @IsOptional()
  timezone?: string;

  @ApiPropertyOptional({ description: 'Worker type for this entry', enum: WorkerType })
  @IsEnum(WorkerType)
  @IsOptional()
  workerType?: WorkerType;
}
