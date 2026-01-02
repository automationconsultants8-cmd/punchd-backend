import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsNumber, IsOptional, IsEnum, IsObject, Min, Max } from 'class-validator';
export * from './approve-time-entry.dto';
export enum EntryType {
  JOB_TIME = 'JOB_TIME',
  TRAVEL_TIME = 'TRAVEL_TIME',
}

export class ClockInDto {
  @ApiProperty({ enum: EntryType, example: 'JOB_TIME' })
  @IsEnum(EntryType)
  @IsNotEmpty()
  entryType: EntryType;

  @ApiProperty({ example: 'uuid-of-job', required: false })
  @IsString()
  @IsOptional()
  jobId?: string;

  @ApiProperty({ example: 34.0522 })
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude: number;

  @ApiProperty({ example: -118.2437 })
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude: number;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  photoUrl?: string;

  @ApiProperty({ required: false })
  @IsObject()
  @IsOptional()
  deviceInfo?: any;
}

export class ClockOutDto {
  @ApiProperty({ example: 34.0530 })
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude: number;

  @ApiProperty({ example: -118.2450 })
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude: number;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  photoUrl?: string;

  @ApiProperty({ required: false })
  @IsObject()
  @IsOptional()
  deviceInfo?: any;
}
