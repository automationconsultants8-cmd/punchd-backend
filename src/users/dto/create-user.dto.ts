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

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  referencePhoto?: string;

  @ApiPropertyOptional({ description: 'Hourly pay rate in dollars' })
  @IsNumber()
  @IsOptional()
  hourlyRate?: number;
}
