import { IsOptional, IsString, IsNumber, IsDateString, Min, Max } from 'class-validator';

export class UpdateTimeEntryDto {
  @IsOptional()
  @IsDateString()
  clockInTime?: string;

  @IsOptional()
  @IsDateString()
  clockOutTime?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(480)
  breakMinutes?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10)
  restBreaksTaken?: number;

  @IsOptional()
  @IsString()
  jobId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
