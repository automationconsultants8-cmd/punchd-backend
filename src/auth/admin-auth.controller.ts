import { Controller, Post, Get, Body, HttpCode, HttpStatus, UnauthorizedException, BadRequestException, Req } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { MailerService } from '@nestjs-modules/mailer';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

@ApiTags('Admin Authentication')
@Controller('admin/auth')
export class AdminAuthController {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private mailerService: MailerService,
    private configService: ConfigService,
  ) {}

  private generateInviteCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    code += '-';
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  // TEMPORARY - List all admin emails (DELETE AFTER FINDING YOUR EMAIL)
  @Get('list-admins')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List all admin users - TEMPORARY' })
  async listAdmins() {
    const users = await this.prisma.user.findMany({
      where: {
        role: { in: ['ADMIN', 'OWNER', 'MANAGER'] },
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
        company: {
          select: {
            name: true,
          },
        },
      },
    });
    
    return users;
  }
  // TEMPORARY - Force reset password (DELETE AFTER USE)
@Post('force-reset-password')
@HttpCode(HttpStatus.OK)
@ApiOperation({ summary: 'Force reset password - TEMPORARY' })
async forceResetPassword(@Body() body: { email: string; newPassword: string }) {
  const { email, newPassword } = body;

  if (!email || !newPassword) {
    throw new BadRequestException('Email and newPassword are required');
  }

  if (newPassword.length < 6) {
    throw new BadRequestException('Password must be at least 6 characters');
  }

  const user = await this.prisma.user.findFirst({
    where: { email: email.toLowerCase().trim() },
  });

  if (!user) {
    throw new BadRequestException('User not found');
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);

  await this.prisma.user.update({
    where: { id: user.id },
    data: { passwordHash },
  });

  console.log(`✅ Password force reset for: ${email}`);

  return { success: true, message: 'Password reset successful' };
}

  @Post('signup')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register new company and owner account' })
  async signup(@Body() body: {
    companyName: string;
    ownerName: string;
    email: string;
    password: string;
    phone: string;
  }) {
    const { companyName, ownerName, email, password, phone } = body;

    if (!companyName || !ownerName || !email || !password || !phone) {
      throw new BadRequestException('All fields are required');
    }

    if (password.length < 6) {
      throw new BadRequestException('Password must be at least 6 characters');
    }

    const existingUser = await this.prisma.user.findFirst({
      where: { email: email.toLowerCase().trim() },
    });

    if (existingUser) {
      throw new BadRequestException('An account with this email already exists');
    }

    let formattedPhone = phone.trim();
    if (!formattedPhone.startsWith('+')) {
      formattedPhone = '+1' + formattedPhone.replace(/\D/g, '');
    }

    const existingPhone = await this.prisma.user.findFirst({
      where: { phone: formattedPhone },
    });

    if (existingPhone) {
      throw new BadRequestException('An account with this phone number already exists');
    }

    let inviteCode = this.generateInviteCode();
    let codeExists = await this.prisma.company.findFirst({ where: { inviteCode } });
    while (codeExists) {
      inviteCode = this.generateInviteCode();
      codeExists = await this.prisma.company.findFirst({ where: { inviteCode } });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + 14);

    const company = await this.prisma.company.create({
      data: {
        name: companyName.trim(),
        inviteCode,
        subscriptionTier: 'professional',
        subscriptionStatus: 'trial',
        trialEndsAt,
      },
    });

    const user = await this.prisma.user.create({
      data: {
        companyId: company.id,
        name: ownerName.trim(),
        email: email.toLowerCase().trim(),
        phone: formattedPhone,
        role: 'OWNER',
        approvalStatus: 'APPROVED',
        passwordHash,
      },
    });

    const payload = {
      userId: user.id,
      companyId: company.id,
      role: user.role,
      email: user.email,
    };

    const accessToken = this.jwtService.sign(payload);

    console.log(`🏢 New company registered: ${company.name} (${inviteCode})`);
    console.log(`👤 Owner: ${user.name} (${user.email})`);
    console.log(`🎁 Trial ends: ${trialEndsAt.toDateString()}`);

    return {
      accessToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        companyId: company.id,
        companyName: company.name,
        inviteCode: company.inviteCode,
      },
    };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin login with email/password' })
  async login(@Body() body: { email: string; password: string }) {
    const { email, password } = body;

    const user = await this.prisma.user.findFirst({
      where: { 
        email: email.toLowerCase().trim(),
        role: { in: ['ADMIN', 'OWNER', 'MANAGER'] },
        isActive: true,
        approvalStatus: 'APPROVED',
      },
      include: { company: true },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!user.passwordHash) {
      throw new UnauthorizedException('Password not set. Please contact support.');
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const payload = {
      userId: user.id,
      companyId: user.companyId,
      role: user.role,
      email: user.email,
    };

    const accessToken = this.jwtService.sign(payload);

    console.log(`🔐 Admin login: ${user.email} (${user.role})`);

    return {
      accessToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        companyId: user.companyId,
        companyName: user.company.name,
        inviteCode: user.company.inviteCode,
      },
    };
  }

  @Get('subscription-status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Check subscription status' })
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
    
    const company = await this.prisma.company.findUnique({
      where: { id: decoded.companyId },
      select: {
        subscriptionStatus: true,
        subscriptionTier: true,
        trialEndsAt: true,
        stripeCustomerId: true,
      },
    });

    if (!company) {
      throw new UnauthorizedException('Company not found');
    }

    const now = new Date();
    const trialExpired = company.trialEndsAt && new Date(company.trialEndsAt) < now;
    const isActive = company.subscriptionStatus === 'active' || 
                     (company.subscriptionStatus === 'trial' && !trialExpired);

    return {
      status: company.subscriptionStatus,
      tier: company.subscriptionTier,
      trialEndsAt: company.trialEndsAt,
      trialExpired,
      isActive,
      daysLeft: company.trialEndsAt 
        ? Math.max(0, Math.ceil((new Date(company.trialEndsAt).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
        : null,
    };
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request password reset email' })
  async forgotPassword(@Body() body: { email: string }) {
    const { email } = body;

    if (!email) {
      throw new BadRequestException('Email is required');
    }

    const user = await this.prisma.user.findFirst({
      where: { 
        email: email.toLowerCase().trim(),
        role: { in: ['ADMIN', 'OWNER', 'MANAGER'] },
        isActive: true,
      },
    });

    if (!user) {
      throw new BadRequestException('No account found with this email address');
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await this.prisma.passwordResetToken.updateMany({
      where: { userId: user.id, used: false },
      data: { used: true },
    });

    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        token,
        expiresAt,
      },
    });

    const resetUrl = `${this.configService.get('FRONTEND_URL') || 'http://localhost:5173'}/reset-password?token=${token}`;

    try {
      await this.mailerService.sendMail({
        to: user.email!,
        subject: "Punch'd - Reset Your Password",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #C9A227;">Reset Your Password</h2>
            <p>Hi ${user.name},</p>
            <p>You requested to reset your password. Click the button below to set a new password:</p>
            <p style="margin: 30px 0;">
              <a href="${resetUrl}" style="background: linear-gradient(135deg, #C9A227, #D4AF37); color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold;">
                Reset Password
              </a>
            </p>
            <p>This link expires in 1 hour.</p>
            <p>If you didn't request this, you can safely ignore this email.</p>
            <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
            <p style="color: #888; font-size: 12px;">Punch'd by Krynovo</p>
          </div>
        `,
      });

      console.log(`📧 Password reset email sent to: ${user.email}`);
      return { success: true, message: 'Password reset email sent!' };
    } catch (err) {
      console.error('❌ Failed to send password reset email:', err.message);
      throw new BadRequestException('Failed to send email. Please try again or contact support.');
    }
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset password with token' })
  async resetPassword(@Body() body: { token: string; password: string }) {
    const { token, password } = body;

    if (!token || !password) {
      throw new BadRequestException('Token and password are required');
    }

    if (password.length < 6) {
      throw new BadRequestException('Password must be at least 6 characters');
    }

    const resetToken = await this.prisma.passwordResetToken.findFirst({
      where: {
        token,
        used: false,
        expiresAt: { gt: new Date() },
      },
      include: { user: true },
    });

    if (!resetToken) {
      throw new BadRequestException('Invalid or expired reset link. Please request a new one.');
    }

    const passwordHash = await bcrypt.hash(password, 10);

    await this.prisma.user.update({
      where: { id: resetToken.userId },
      data: { passwordHash },
    });

    await this.prisma.passwordResetToken.update({
      where: { id: resetToken.id },
      data: { used: true },
    });

    console.log(`✅ Password reset successful for: ${resetToken.user.email}`);

    return { success: true, message: 'Password reset successful. You can now log in.' };
  }
}
