import { IsEmail, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginWithPasswordDto {
  @ApiProperty({ example: 'manager@company.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'SecurePassword123' })
  @IsString()
  @MinLength(8)
  password: string;
}

export class SetPasswordDto {
  @ApiProperty({ example: 'user-uuid-here' })
  @IsString()
  userId: string;

  @ApiProperty({ example: 'SecurePassword123' })
  @IsString()
  @MinLength(8)
  password: string;
}
