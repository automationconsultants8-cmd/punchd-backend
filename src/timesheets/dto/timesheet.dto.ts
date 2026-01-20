import { IsString, IsOptional, IsDateString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTimesheetDto {
  @ApiProperty({ description: 'Start of period (YYYY-MM-DD)' })
  @IsDateString()
  periodStart: string;

  @ApiProperty({ description: 'End of period (YYYY-MM-DD)' })
  @IsDateString()
  periodEnd: string;
}

export class SubmitTimesheetDto {
  @ApiProperty()
  @IsString()
  timesheetId: string;
}

export class ReviewTimesheetDto {
  @ApiProperty({ enum: ['APPROVED', 'REJECTED'] })
  @IsString()
  status: 'APPROVED' | 'REJECTED';

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  notes?: string;
}
