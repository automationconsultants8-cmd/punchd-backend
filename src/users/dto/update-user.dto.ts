import { IsString, IsEmail, IsOptional, IsEnum, IsBoolean, IsNumber } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateUserDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional()
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional({ enum: ['WORKER', 'MANAGER', 'ADMIN', 'OWNER'] })
  @IsEnum(['WORKER', 'MANAGER', 'ADMIN', 'OWNER'])
  @IsOptional()
  role?: string;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({ enum: ['PENDING', 'APPROVED', 'REJECTED'] })
  @IsEnum(['PENDING', 'APPROVED', 'REJECTED'])
  @IsOptional()
  approvalStatus?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  referencePhoto?: string;

  @ApiPropertyOptional({ description: 'Hourly pay rate in dollars' })
  @IsNumber()
  @IsOptional()
  hourlyRate?: number;
}
