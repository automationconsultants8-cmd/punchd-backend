import { Controller, Post, Body, Get, HttpCode, HttpStatus, Req, UnauthorizedException, UseGuards, Request, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { LoginWithPasswordDto, SetPasswordDto } from './dto/login-password.dto';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  // ============================================
  // OTP-BASED AUTH (Workers - Mobile App)
  // ============================================

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
  @ApiOperation({ summary: 'Login after OTP verification (Mobile - Workers)' })
  async login(@Body() body: { phone: string }) {
    return this.authService.login(body.phone);
  }

  @Post('contractor-login')
  @ApiOperation({ summary: 'Contractor login with email and password' })
  async contractorLogin(@Body() loginDto: { email: string; password: string }) {
  return this.authService.contractorLogin(loginDto.email, loginDto.password);
}

  // ============================================
// VOLUNTEER AUTH (Phone + SMS Code)
// ============================================

@Post('volunteer/send-code')
@HttpCode(HttpStatus.OK)
@ApiOperation({ summary: 'Send verification code to volunteer phone' })
async sendVolunteerCode(@Body() body: { phone: string }) {
  return this.authService.sendVolunteerCode(body.phone);
}

@Post('volunteer/verify-code')
@HttpCode(HttpStatus.OK)
@ApiOperation({ summary: 'Verify code and login volunteer' })
async verifyVolunteerCode(@Body() body: { phone: string; code: string }) {
  return this.authService.verifyVolunteerCode(body.phone, body.code);
}


  @Post('verify-otp-and-login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify OTP and login in one step (Mobile - Workers)' })
  async verifyOtpAndLogin(@Body() body: { phone: string; code: string }) {
    return this.authService.verifyOTPAndLogin(body.phone, body.code);
  }

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register new worker (Mobile App)' })
  async register(@Body() body: {
    phone: string;
    name: string;
    email?: string;
    companyCode: string;
    referencePhoto?: string;
  }) {
    return this.authService.register(body);
  }

  // ============================================
  // PASSWORD-BASED AUTH (Manager/Admin/Owner - Dashboard)
  // ============================================

  @Post('login/dashboard')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email/password (Manager/Admin/Owner - Dashboard)' })
  async loginWithPassword(@Body() dto: LoginWithPasswordDto) {
    return this.authService.loginWithPassword(dto.email, dto.password);
  }

  @Post('set-password')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Set password for a user (Owner/Admin only)' })
  async setPassword(@Request() req, @Body() dto: SetPasswordDto) {
    // Only Owner/Admin can set passwords
    if (req.user.role !== 'OWNER' && req.user.role !== 'ADMIN') {
      throw new ForbiddenException('Only owners and admins can set passwords');
    }
    return this.authService.setPassword(dto.userId, dto.password, req.user.companyId);
  }

  // ============================================
  // CURRENT USER
  // ============================================

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user with permissions' })
  async getCurrentUser(@Request() req) {
    return this.authService.getCurrentUser(req.user.userId, req.user.companyId);
  }

  // ============================================
  // UTILITIES
  // ============================================

  @Get('companies')
  @ApiOperation({ summary: 'Get list of companies' })
  async getCompanies() {
    return this.authService.getCompanies();
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

  // ============================================
  // TEST/DEV ENDPOINTS (Remove in production)
  // ============================================

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

  @Post('reset-database-test')
  @HttpCode(HttpStatus.OK)
  async resetDatabaseTest() {
    // Delete in order to respect foreign keys
    await this.prisma.auditLog.deleteMany();
    await this.prisma.breakViolation.deleteMany();
    await this.prisma.faceVerificationLog.deleteMany();
    await this.prisma.violation.deleteMany();
    await this.prisma.timeEntry.deleteMany();
    await this.prisma.shiftOffer.deleteMany();
    await this.prisma.shiftRequest.deleteMany();
    await this.prisma.timeOffRequest.deleteMany();
    await this.prisma.message.deleteMany();
    await this.prisma.shift.deleteMany();
    await this.prisma.workerJobRate.deleteMany();
    await this.prisma.certifiedPayroll.deleteMany();
    await this.prisma.managerPermission.deleteMany();
    await this.prisma.managerLocationAssignment.deleteMany();
    await this.prisma.managerWorkerAssignment.deleteMany();
    await this.prisma.payPeriod.deleteMany();
    await this.prisma.job.deleteMany();
    await this.prisma.passwordResetToken.deleteMany();
    await this.prisma.pushToken.deleteMany();
    await this.prisma.otpCode.deleteMany();
    await this.prisma.user.deleteMany();
    await this.prisma.company.deleteMany();
    
    return { success: true, message: 'Database reset complete' };
  }
}
