import { IsString, IsNumber, IsBoolean, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SetWorkerJobRateDto {
  @ApiProperty({ description: 'Job ID' })
  @IsString()
  jobId: string;

  @ApiProperty({ description: 'Hourly rate for this worker on this job' })
  @IsNumber()
  hourlyRate: number;

  @ApiPropertyOptional({ description: 'Is this a prevailing wage rate?' })
  @IsBoolean()
  @IsOptional()
  isPrevailingWage?: boolean;

  @ApiPropertyOptional({ description: 'Notes about this rate' })
  @IsString()
  @IsOptional()
  notes?: string;
}
