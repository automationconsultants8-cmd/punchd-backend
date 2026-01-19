import { Injectable, UnauthorizedException, BadRequestException, ForbiddenException, HttpException, HttpStatus } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { AwsService } from '../aws/aws.service';
import * as bcrypt from 'bcrypt';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const twilio = require('twilio');

@Injectable()
export class AuthService {
  private twilioClient: any;
  private verifyServiceSid: string | undefined;

  // Rate limit settings 
  private readonly MAX_OTP_PER_HOUR = 10;

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private awsService: AwsService,
  ) {
    const accountSid = this.configService.get<string>('TWILIO_ACCOUNT_SID');
    const authToken = this.configService.get<string>('TWILIO_AUTH_TOKEN');
    this.verifyServiceSid = this.configService.get<string>('TWILIO_VERIFY_SERVICE_SID');
    
    if (accountSid && authToken) {
      this.twilioClient = twilio(accountSid, authToken);
      console.log('✅ Twilio client initialized');
    } else {
      console.warn('⚠️ Twilio credentials not found - SMS will be mocked');
    }
  }

  // ============================================
  // OTP-BASED AUTH (Workers - Mobile App)
  // ============================================

  async sendOTP(phone: string): Promise<{ success: boolean; expiresIn: number }> {
    // Rate limiting check
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    
    const recentOtpCount = await this.prisma.otpCode.count({
      where: {
        phone,
        createdAt: { gt: oneHourAgo },
      },
    });

    if (recentOtpCount >= this.MAX_OTP_PER_HOUR) {
      console.log(`🚫 Rate limit exceeded for ${phone} (${recentOtpCount} requests in last hour)`);
      throw new HttpException(
        `Too many verification requests. Please try again later.`,
        HttpStatus.TOO_MANY_REQUESTS
      );
    }

    if (this.twilioClient && this.verifyServiceSid) {
      try {
        await this.twilioClient.verify.v2
          .services(this.verifyServiceSid)
          .verifications.create({
            to: phone,
            channel: 'sms',
          });
        
        // Log the OTP request for rate limiting (even for Twilio)
        await this.prisma.otpCode.create({
          data: { 
            phone, 
            code: 'TWILIO',
            expiresAt: new Date(Date.now() + 10 * 60 * 1000),
          },
        });

        console.log(`📱 Verification SMS sent to ${phone} (${recentOtpCount + 1}/${this.MAX_OTP_PER_HOUR} this hour)`);
        return { success: true, expiresIn: 600 };
      } catch (error) {
        console.error('❌ Twilio Verify failed:', error.message);
        return this.sendMockOTP(phone);
      }
    } else {
      return this.sendMockOTP(phone);
    }
  }

  private async sendMockOTP(phone: string): Promise<{ success: boolean; expiresIn: number }> {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await this.prisma.otpCode.create({
      data: { phone, code, expiresAt },
    });

    console.log(`📱 OTP for ${phone}: ${code}`);
    return { success: true, expiresIn: 600 };
  }

  async verifyOTP(phone: string, code: string): Promise<{ verified: boolean; userExists: boolean; user?: any }> {
    let verified = false;

    // Try Twilio Verify first
    if (this.twilioClient && this.verifyServiceSid) {
      try {
        const verificationCheck = await this.twilioClient.verify.v2
          .services(this.verifyServiceSid)
          .verificationChecks.create({
            to: phone,
            code: code,
          });

        verified = verificationCheck.status === 'approved';
        console.log(`📱 Twilio verification status: ${verificationCheck.status}`);
      } catch (error) {
        console.error('❌ Twilio verification check failed:', error.message);
      }
    }

    // Fall back to database OTP check
    if (!verified) {
      const otpRecord = await this.prisma.otpCode.findFirst({
        where: {
          phone,
          code,
          verified: false,
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (otpRecord) {
        await this.prisma.otpCode.update({
          where: { id: otpRecord.id },
          data: { verified: true },
        });
        verified = true;
      }
    }

    if (!verified) {
      throw new UnauthorizedException('Invalid or expired OTP code');
    }

    // Check if user exists
    const user = await this.prisma.user.findFirst({
      where: { phone },
      include: { company: true },
    });

    return {
      verified: true,
      userExists: !!user,
      user: user ? {
        id: user.id,
        name: user.name,
        phone: user.phone,
        role: user.role,
        workerTypes: user.workerTypes,
        companyId: user.companyId,
        approvalStatus: user.approvalStatus,
      } : undefined,
    };
  }

  // ============================================
  // PASSWORD-BASED AUTH (Manager/Admin/Owner - Dashboard)
  // ============================================

  async loginWithPassword(email: string, password: string): Promise<{ accessToken: string; user: any }> {
    // Find user by email
    const user = await this.prisma.user.findFirst({
      where: { 
        email: email.toLowerCase().trim(),
        isActive: true,
      },
      include: { 
        company: true,
        managerPermission: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // Workers cannot login to dashboard
    if (user.role === 'WORKER') {
      throw new ForbiddenException('Workers must use the mobile app to clock in. Dashboard access is for managers and administrators only.');
    }

    // Check password exists
    if (!user.passwordHash) {
      throw new UnauthorizedException('Password not set. Please contact your administrator to set up dashboard access.');
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // Check approval status
    if (user.approvalStatus === 'PENDING') {
      throw new ForbiddenException('Your account is pending approval.');
    }

    if (user.approvalStatus === 'REJECTED') {
      throw new ForbiddenException('Your account has been rejected. Please contact your administrator.');
    }

    // Build JWT payload
    const payload = {
      userId: user.id,
      companyId: user.companyId,
      role: user.role,
      email: user.email,
    };

    const accessToken = this.jwtService.sign(payload);

    // Log the login
    await this.prisma.auditLog.create({
      data: {
        companyId: user.companyId,
        userId: user.id,
        action: 'LOGIN',
        details: { method: 'password', role: user.role },
      },
    });

    console.log(`🔐 Dashboard login: ${user.name} (${user.role}) - ${user.email}`);

    // Build response based on role
    const response: any = {
      accessToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        companyId: user.companyId,
        companyName: user.company.name,
      },
    };

    // Include permissions for managers
    if (user.role === 'MANAGER' && user.managerPermission) {
      response.user.permissions = {
        canApproveTime: user.managerPermission.canApproveTime,
        canEditTimePre: user.managerPermission.canEditTimePre,
        canEditTimePost: user.managerPermission.canEditTimePost,
        canDeleteTime: user.managerPermission.canDeleteTime,
        canViewLaborCosts: user.managerPermission.canViewLaborCosts,
        canViewAllLocations: user.managerPermission.canViewAllLocations,
        canViewAllWorkers: user.managerPermission.canViewAllWorkers,
        canExportPayroll: user.managerPermission.canExportPayroll,
        canViewAnalytics: user.managerPermission.canViewAnalytics,
        canGenerateReports: user.managerPermission.canGenerateReports,
        canOnboardWorkers: user.managerPermission.canOnboardWorkers,
        canDeactivateWorkers: user.managerPermission.canDeactivateWorkers,
        canEditWorkerRates: user.managerPermission.canEditWorkerRates,
        canCreateShifts: user.managerPermission.canCreateShifts,
        canEditShifts: user.managerPermission.canEditShifts,
        canDeleteShifts: user.managerPermission.canDeleteShifts,
        canApproveShiftSwaps: user.managerPermission.canApproveShiftSwaps,
        canApproveTimeOff: user.managerPermission.canApproveTimeOff,
        canReviewViolations: user.managerPermission.canReviewViolations,
        canWaiveViolations: user.managerPermission.canWaiveViolations,
      };

      // Get manager's assigned locations
      const locationAssignments = await this.prisma.managerLocationAssignment.findMany({
        where: { managerId: user.id },
        select: { locationId: true },
      });
      response.user.assignedLocationIds = locationAssignments.map(a => a.locationId);

      // Get manager's assigned workers
      const workerAssignments = await this.prisma.managerWorkerAssignment.findMany({
        where: { managerId: user.id },
        select: { workerId: true },
      });
      response.user.assignedWorkerIds = workerAssignments.map(a => a.workerId);
    }

    return response;
  }

  // ============================================
  // CONTRACTOR LOGIN (Contractor Portal)
  // ============================================

  async contractorLogin(email: string, password: string): Promise<{ access_token: string; user: any }> {
    const user = await this.prisma.user.findFirst({
      where: { 
        email: email.toLowerCase().trim(),
        isActive: true,
      },
      include: { company: true },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!user.passwordHash) {
      throw new UnauthorizedException('Password not set. Contact your administrator.');
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!user.workerTypes.includes('CONTRACTOR')) {
      throw new UnauthorizedException('Access denied. This portal is for contractors only.');
    }

    const payload = {
      sub: user.id,
      companyId: user.companyId,
      role: user.role,
      userId: user.id,
    };

    console.log(`🔐 Contractor login: ${user.name} - ${user.email}`);

    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        workerTypes: user.workerTypes,
        companyId: user.companyId,
        companyName: user.company.name,
      },
    };
  }

  // ============================================
  // SET PASSWORD (for new managers/admins)
  // ============================================

  async setPassword(userId: string, password: string, companyId: string): Promise<{ success: boolean }> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, companyId },
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    if (user.role === 'WORKER') {
      throw new BadRequestException('Workers do not need dashboard passwords');
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });

    console.log(`🔑 Password set for ${user.name} (${user.role})`);

    return { success: true };
  }

  // ============================================
  // WORKER REGISTRATION (Mobile App)
  // ============================================

  async register(data: {
    phone: string;
    name: string;
    email?: string;
    companyCode: string;
    referencePhoto?: string;
  }) {
    // Find company by invite code (case-insensitive)
    const company = await this.prisma.company.findFirst({
      where: { 
        inviteCode: {
          equals: data.companyCode.toUpperCase().trim(),
          mode: 'insensitive',
        },
        isActive: true,
      },
    });

    if (!company) {
      throw new BadRequestException('Invalid invite code. Please check with your administrator.');
    }

    // Check if user already exists in this company
    const existing = await this.prisma.user.findFirst({
      where: { 
        phone: data.phone,
        companyId: company.id,
      },
    });

    if (existing) {
      // Handle different scenarios for existing users
      
      // Case 1: Deactivated user trying to re-register
      if (!existing.isActive) {
        const reactivated = await this.prisma.user.update({
          where: { id: existing.id },
          data: {
            isActive: true,
            approvalStatus: 'PENDING',
            name: data.name,
            email: data.email,
          },
          include: { company: true },
        });

        console.log(`♻️ Deactivated user re-registered: ${reactivated.name} - ${reactivated.phone}`);

        return {
          success: true,
          message: 'Your account has been resubmitted for approval. Please wait for admin approval.',
          user: {
            id: reactivated.id,
            name: reactivated.name,
            phone: reactivated.phone,
            approvalStatus: reactivated.approvalStatus,
            companyName: company.name,
          },
        };
      }

      // Case 2: Rejected user trying to re-register
      if (existing.approvalStatus === 'REJECTED') {
        const reapplied = await this.prisma.user.update({
          where: { id: existing.id },
          data: {
            approvalStatus: 'PENDING',
            name: data.name,
            email: data.email,
          },
          include: { company: true },
        });

        console.log(`🔄 Rejected user re-applied: ${reapplied.name} - ${reapplied.phone}`);

        return {
          success: true,
          message: 'Your registration has been resubmitted for approval.',
          user: {
            id: reapplied.id,
            name: reapplied.name,
            phone: reapplied.phone,
            approvalStatus: reapplied.approvalStatus,
            companyName: company.name,
          },
        };
      }

      // Case 3: Pending user trying to register again
      if (existing.approvalStatus === 'PENDING') {
        throw new ForbiddenException('Your registration is still pending approval. Please wait for admin to approve.');
      }

      // Case 4: Active approved user
      throw new ForbiddenException('You are already registered with this company. Please use login instead.');
    }

    // Upload reference photo if provided
    let referencePhotoUrl: string | undefined = undefined;
    if (data.referencePhoto) {
      try {
        const tempId = `pending-${Date.now()}`;
        referencePhotoUrl = await this.awsService.uploadPhoto(
          data.referencePhoto,
          tempId,
          'clock-in',
        );
        console.log('📸 Reference photo uploaded for new registration');
      } catch (err) {
        console.error('Failed to upload reference photo:', err);
      }
    }

    // Create user with PENDING status
    const user = await this.prisma.user.create({
      data: {
        companyId: company.id,
        phone: data.phone,
        name: data.name,
        email: data.email,
        role: 'WORKER',
        approvalStatus: 'PENDING',
        referencePhotoUrl,
      },
      include: { company: true },
    });

    console.log(`👤 New user registered (pending approval): ${user.name} - ${user.phone} for ${company.name}`);

    return {
      success: true,
      message: 'Registration submitted! Please wait for admin approval.',
      user: {
        id: user.id,
        name: user.name,
        phone: user.phone,
        approvalStatus: user.approvalStatus,
        companyName: company.name,
      },
    };
  }

  // ============================================
  // WORKER LOGIN (Mobile App - OTP)
  // ============================================

  async login(phone: string): Promise<{ accessToken: string; user: any }> {
    const user = await this.prisma.user.findFirst({
      where: { phone },
      include: { company: true },
    });

    if (!user) {
      throw new BadRequestException('User not found. Please register first.');
    }

    if (user.approvalStatus === 'PENDING') {
      throw new ForbiddenException('Your account is pending approval. Please wait for admin to approve.');
    }

    if (user.approvalStatus === 'REJECTED') {
      throw new ForbiddenException('Your registration was rejected. Please contact your administrator.');
    }

    if (!user.isActive) {
      throw new ForbiddenException('Your account has been deactivated. Please contact your administrator.');
    }

    const payload = {
      userId: user.id,
      companyId: user.companyId,
      role: user.role,
      phone: user.phone,
    };

    const accessToken = this.jwtService.sign(payload);

    // Log the login
    await this.prisma.auditLog.create({
      data: {
        companyId: user.companyId,
        userId: user.id,
        action: 'LOGIN',
        details: { method: 'otp', role: user.role },
      },
    });

    return {
      accessToken,
      user: {
        id: user.id,
        name: user.name,
        phone: user.phone,
        role: user.role,
        workerTypes: user.workerTypes,
        companyId: user.companyId,
        companyName: user.company.name,
      },
    };
  }

  async verifyOTPAndLogin(phone: string, code: string): Promise<{ accessToken: string; user: any }> {
    const verifyResult = await this.verifyOTP(phone, code);
    
    if (!verifyResult.userExists) {
      throw new BadRequestException('User not found. Please register first.');
    }

    return this.login(phone);
  }

  // ============================================
  // VALIDATION & UTILITIES
  // ============================================

  async validateUser(userId: string, companyId: string): Promise<any> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, companyId, isActive: true, approvalStatus: 'APPROVED' },
      include: { company: true },
    });

    if (!user) {
      throw new UnauthorizedException('User not found or inactive');
    }

    return user;
  }

  async getCompanies() {
    return [];
  }

  // Get current user with permissions (for dashboard)
  async getCurrentUser(userId: string, companyId: string): Promise<any> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, companyId, isActive: true },
      include: { 
        company: true,
        managerPermission: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const response: any = {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      companyId: user.companyId,
      companyName: user.company.name,
    };

    // Include permissions for managers
    if (user.role === 'MANAGER' && user.managerPermission) {
      response.permissions = {
        canApproveTime: user.managerPermission.canApproveTime,
        canEditTimePre: user.managerPermission.canEditTimePre,
        canEditTimePost: user.managerPermission.canEditTimePost,
        canDeleteTime: user.managerPermission.canDeleteTime,
        canViewLaborCosts: user.managerPermission.canViewLaborCosts,
        canViewAllLocations: user.managerPermission.canViewAllLocations,
        canViewAllWorkers: user.managerPermission.canViewAllWorkers,
        canExportPayroll: user.managerPermission.canExportPayroll,
        canViewAnalytics: user.managerPermission.canViewAnalytics,
        canGenerateReports: user.managerPermission.canGenerateReports,
        canOnboardWorkers: user.managerPermission.canOnboardWorkers,
        canDeactivateWorkers: user.managerPermission.canDeactivateWorkers,
        canEditWorkerRates: user.managerPermission.canEditWorkerRates,
        canCreateShifts: user.managerPermission.canCreateShifts,
        canEditShifts: user.managerPermission.canEditShifts,
        canDeleteShifts: user.managerPermission.canDeleteShifts,
        canApproveShiftSwaps: user.managerPermission.canApproveShiftSwaps,
        canApproveTimeOff: user.managerPermission.canApproveTimeOff,
        canReviewViolations: user.managerPermission.canReviewViolations,
        canWaiveViolations: user.managerPermission.canWaiveViolations,
      };

      // Get manager's assigned locations
      const locationAssignments = await this.prisma.managerLocationAssignment.findMany({
        where: { managerId: user.id },
        select: { locationId: true },
      });
      response.assignedLocationIds = locationAssignments.map(a => a.locationId);

      // Get manager's assigned workers
      const workerAssignments = await this.prisma.managerWorkerAssignment.findMany({
        where: { managerId: user.id },
        select: { workerId: true },
      });
      response.assignedWorkerIds = workerAssignments.map(a => a.workerId);
    }

    return response;
  }
}
