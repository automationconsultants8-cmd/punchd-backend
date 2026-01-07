import { Controller, Post, Body, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AuthService } from './auth.service';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('send-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send OTP code to phone number' })
  async sendOtp(@Body() body: { phone: string }) {
    return this.authService.sendOTP(body.phone);
  }

  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify OTP code' })
  async verifyOtp(@Body() body: { phone: string; code: string }) {
    return this.authService.verifyOTP(body.phone, body.code);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login after OTP verification' })
  async login(@Body() body: { phone: string }) {
    return this.authService.login(body.phone);
  }

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register new worker' })
  async register(@Body() body: {
    phone: string;
    name: string;
    email?: string;
    companyCode: string;
    referencePhoto?: string;
  }) {
    return this.authService.register(body);
  }

  @Get('companies')
  @ApiOperation({ summary: 'Get list of companies' })
  async getCompanies() {
    return this.authService.getCompanies();
  }
}
@Post('set-trial-test')
async setTrialTest(@Body() body: { days: number }) {
  const companies = await this.prisma.company.updateMany({
    data: {
      subscriptionTier: 'trial',
      trialEndsAt: new Date(Date.now() + (body.days || 2) * 24 * 60 * 60 * 1000)
    }
  });
  return { updated: companies.count };
}
