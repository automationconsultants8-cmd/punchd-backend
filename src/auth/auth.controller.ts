import { Controller, Post, Body, Get, HttpCode, HttpStatus, Req, UnauthorizedException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

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

  @Post('set-trial-test')
  @HttpCode(HttpStatus.OK)
  async setTrialTest(@Body() body: { days: number }) {
    const companies = await this.prisma.company.updateMany({
      data: {
        subscriptionTier: 'trial',
        trialEndsAt: new Date(Date.now() + (body.days || 2) * 24 * 60 * 60 * 1000)
      }
    });
    return { updated: companies.count };
  }

  @Get('subscription-status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Check subscription status for mobile workers' })
  async getSubscriptionStatus(@Req() req) {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      throw new UnauthorizedException('No token provided');
    }

    let decoded;
    try {
      decoded = this.jwtService.verify(token);
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
    
    const user = await this.prisma.user.findUnique({
      where: { id: decoded.userId },
      include: { company: true },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const company = user.company;
    const now = new Date();
    const daysRemaining = company.trialEndsAt 
      ? Math.max(0, Math.ceil((new Date(company.trialEndsAt).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
      : null;
    
    const trialExpired = company.trialEndsAt && new Date(company.trialEndsAt) < now;
    const isWarningPeriod = daysRemaining !== null && daysRemaining <= 2 && daysRemaining > 0;
    const isActive = company.subscriptionStatus === 'active' || 
                     (company.subscriptionStatus === 'trial' && !trialExpired);

    return {
      status: company.subscriptionStatus,
      tier: company.subscriptionTier,
      trialEndsAt: company.trialEndsAt,
      trialExpired,
      isActive,
      daysRemaining,
      isWarningPeriod,
    };
  }
}
