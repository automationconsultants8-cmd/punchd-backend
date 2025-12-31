import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, Matches, Length, IsOptional, IsEmail } from 'class-validator';

export class SendOtpDto {
  @ApiProperty({ example: '+15551234567', description: 'Phone number with country code' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\+[1-9]\d{1,14}$/, {
    message: 'Phone must be in E.164 format (e.g., +15551234567)',
  })
  phone: string;
}

export class VerifyOtpDto {
  @ApiProperty({ example: '+15551234567', description: 'Phone number with country code' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\+[1-9]\d{1,14}$/, {
    message: 'Phone must be in E.164 format (e.g., +15551234567)',
  })
  phone: string;

  @ApiProperty({ example: '123456', description: '6-digit OTP code' })
  @IsString()
  @IsNotEmpty()
  @Length(6, 6)
  code: string;
}

export class RegisterDto {
  @ApiProperty({ example: '+15551234567', description: 'Phone number with country code' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\+[1-9]\d{1,14}$/, {
    message: 'Phone must be in E.164 format (e.g., +15551234567)',
  })
  phone: string;

  @ApiProperty({ example: 'John Smith', description: 'Full name' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'john@example.com', description: 'Email address', required: false })
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiProperty({ example: 'ACME Construction', description: 'Company name or code' })
  @IsString()
  @IsNotEmpty()
  companyCode: string;

  @ApiProperty({ example: 'data:image/jpeg;base64,...', description: 'Reference photo for face verification', required: false })
  @IsString()
  @IsOptional()
  referencePhoto?: string;
}