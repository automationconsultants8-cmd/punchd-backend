import { Controller, Post, Body, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { EmailService } from './email.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Email')
@Controller('email')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class EmailController {
  constructor(private readonly emailService: EmailService) {}

  @Post('send-weekly-report')
  @ApiOperation({ summary: 'Send weekly report email' })
  sendWeeklyReport(@Request() req, @Body() body: { email: string }) {
    return this.emailService.sendWeeklyReport(body.email, req.user.companyId);
  }

  @Post('send-overtime-alert')
  @ApiOperation({ summary: 'Send overtime alert email' })
  sendOvertimeAlert(@Body() body: { email: string; workerName: string; totalHours: number }) {
    return this.emailService.sendOvertimeAlert(body.email, body.workerName, body.totalHours);
  }
}