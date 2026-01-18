import { IsString, IsEmail, IsOptional, IsEnum, IsNumber } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateUserDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty()
  @IsString()
  phone: string;

  @ApiPropertyOptional()
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional({ enum: ['WORKER', 'MANAGER', 'ADMIN', 'OWNER'] })
  @IsEnum(['WORKER', 'MANAGER', 'ADMIN', 'OWNER'])
  @IsOptional()
  role?: string;

  @ApiPropertyOptional({ enum: ['HOURLY', 'SALARIED', 'CONTRACTOR', 'VOLUNTEER'] })
  @IsEnum(['HOURLY', 'SALARIED', 'CONTRACTOR', 'VOLUNTEER'])
  @IsOptional()
  workerType?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  referencePhoto?: string;

  @ApiPropertyOptional({ description: 'Hourly pay rate in dollars' })
  @IsNumber()
  @IsOptional()
  hourlyRate?: number;

  // WH-347 Fields
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  address?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  city?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  state?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  zip?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  lastFourSSN?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  tradeClassification?: string;
}
