import { IsString, IsNumber, IsOptional, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ClockInDto {
  @ApiProperty({ enum: ['JOB_TIME', 'TRAVEL_TIME'] })
  @IsEnum(['JOB_TIME', 'TRAVEL_TIME'])
  entryType: 'JOB_TIME' | 'TRAVEL_TIME';

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  jobId?: string;

  @ApiProperty()
  @IsNumber()
  latitude: number;

  @ApiProperty()
  @IsNumber()
  longitude: number;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  photoUrl?: string;
}
