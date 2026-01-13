import { Injectable } from '@nestjs/common';
import * as sgMail from '@sendgrid/mail';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class EmailService {
  constructor(private prisma: PrismaService) {
    sgMail.setApiKey(process.env.SENDGRID_API_KEY || '');
  }

  private async sendEmail(to: string, subject: string, html: string) {
    const msg = {
      to,
      from: process.env.EMAIL_FROM || 'noreply@gopunchd.com',
      subject,
      html,
    };

    try {
      await sgMail.send(msg);
      console.log(`📧 Email sent to ${to}`);
      return { success: true };
    } catch (error) {
      console.error('❌ Email send error:', error.response?.body || error.message);
      throw error;
    }
  }

  async sendPasswordResetEmail(toEmail: string, userName: string, resetUrl: string) {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #C9A227;">Reset Your Password</h2>
        <p>Hi ${userName},</p>
        <p>You requested to reset your password. Click the button below to set a new password:</p>
        <p style="margin: 30px 0;">
          <a href="${resetUrl}" style="background: linear-gradient(135deg, #C9A227, #D4AF37); color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold;">
            Reset Password
          </a>
        </p>
        <p>This link expires in 1 hour.</p>
        <p>If you didn't request this, you can safely ignore this email.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
        <p style="color: #888; font-size: 12px;">Punch'd Time & Attendance System</p>
      </div>
    `;

    await this.sendEmail(toEmail, "Punch'd - Reset Your Password", html);
    return { success: true };
  }

  async sendWelcomeEmail(email: string, name: string, role: string): Promise<void> {
    const roleDisplay = role === 'MANAGER' ? 'Manager' : 'Administrator';
    
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #C9A227; padding: 20px; text-align: center;">
          <h1 style="color: white; margin: 0;">Welcome to Punch'd</h1>
        </div>
        <div style="padding: 30px; background: #f9f9f9;">
          <h2 style="color: #333;">Hi ${name},</h2>
          <p style="color: #666; font-size: 16px; line-height: 1.6;">
            You've been added as a <strong>${roleDisplay}</strong> on Punch'd.
          </p>
          <p style="color: #666; font-size: 16px; line-height: 1.6;">
            You can now log in to the dashboard at:
          </p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="https://app.gopunchd.com" 
               style="background: #C9A227; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold;">
              Go to Dashboard
            </a>
          </div>
          <p style="color: #666; font-size: 14px;">
            Use your email and password to sign in.
          </p>
        </div>
        <div style="padding: 20px; text-align: center; color: #999; font-size: 12px;">
          <p>© ${new Date().getFullYear()} Punch'd by Krynovo</p>
        </div>
      </div>
    `;

    await this.sendEmail(email, `Welcome to Punch'd - You're now a ${roleDisplay}`, html);
  }

  async sendRoleChangeEmail(email: string, name: string, newRole: string): Promise<void> {
    const roleDisplay = newRole === 'MANAGER' ? 'Manager' : newRole === 'ADMIN' ? 'Administrator' : 'Worker';
    
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #C9A227; padding: 20px; text-align: center;">
          <h1 style="color: white; margin: 0;">Role Updated</h1>
        </div>
        <div style="padding: 30px; background: #f9f9f9;">
          <h2 style="color: #333;">Hi ${name},</h2>
          <p style="color: #666; font-size: 16px; line-height: 1.6;">
            Your role on Punch'd has been updated to <strong>${roleDisplay}</strong>.
          </p>
          ${newRole !== 'WORKER' ? `
          <p style="color: #666; font-size: 16px; line-height: 1.6;">
            You can now access the dashboard at:
          </p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="https://app.gopunchd.com" 
               style="background: #C9A227; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold;">
              Go to Dashboard
            </a>
          </div>
          ` : ''}
        </div>
        <div style="padding: 20px; text-align: center; color: #999; font-size: 12px;">
          <p>© ${new Date().getFullYear()} Punch'd by Krynovo</p>
        </div>
      </div>
    `;

    await this.sendEmail(email, `Your Punch'd role has been updated to ${roleDisplay}`, html);
  }

  async sendWeeklyReport(toEmail: string, companyId: string) {
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    const entries = await this.prisma.timeEntry.findMany({
      where: {
        companyId,
        clockInTime: { gte: weekAgo },
      },
      include: {
        user: { select: { name: true } },
        job: { select: { name: true } },
      },
    });

    const totalMinutes = entries.reduce((sum, e) => sum + (e.durationMinutes || 0), 0);
    const totalHours = (totalMinutes / 60).toFixed(1);
    const totalBreakMinutes = entries.reduce((sum, e) => sum + (e.breakMinutes || 0), 0);

    const workerHours: Record<string, number> = {};
    entries.forEach(e => {
      const name = e.user?.name || 'Unknown';
      workerHours[name] = (workerHours[name] || 0) + (e.durationMinutes || 0);
    });

    const overtimeWorkers = Object.entries(workerHours)
      .filter(([_, mins]) => mins > 40 * 60)
      .map(([name, mins]) => ({
        name,
        hours: (mins / 60).toFixed(1),
        overtime: ((mins / 60) - 40).toFixed(1),
      }));

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #C9A227; border-bottom: 2px solid #C9A227; padding-bottom: 10px;">
          Weekly Time & Attendance Report
        </h1>

        <p style="color: #666;">Report for: ${weekAgo.toLocaleDateString()} - ${new Date().toLocaleDateString()}</p>

        <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h2 style="margin-top: 0; color: #333;">Summary</h2>
          <p><strong>Total Entries:</strong> ${entries.length}</p>
          <p><strong>Total Hours Worked:</strong> ${totalHours} hours</p>
          <p><strong>Total Break Time:</strong> ${(totalBreakMinutes / 60).toFixed(1)} hours</p>
          <p><strong>Estimated Labor Cost:</strong> $${(parseFloat(totalHours) * 30).toFixed(2)}</p>
        </div>

        ${overtimeWorkers.length > 0 ? `
          <div style="background: #fff3cd; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ffc107;">
            <h2 style="margin-top: 0; color: #856404;">Overtime Alert</h2>
            <p>The following workers exceeded 40 hours this week:</p>
            <ul>
              ${overtimeWorkers.map(w => `
                <li><strong>${w.name}</strong>: ${w.hours} hours (${w.overtime} hrs overtime)</li>
              `).join('')}
            </ul>
          </div>
        ` : `
          <div style="background: #d4edda; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #28a745;">
            <h2 style="margin-top: 0; color: #155724;">No Overtime</h2>
            <p>All workers stayed under 40 hours this week.</p>
          </div>
        `}

        <div style="background: #e9ecef; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h2 style="margin-top: 0; color: #333;">Hours by Worker</h2>
          <table style="width: 100%; border-collapse: collapse;">
            <tr style="background: #dee2e6;">
              <th style="padding: 10px; text-align: left;">Worker</th>
              <th style="padding: 10px; text-align: right;">Hours</th>
            </tr>
            ${Object.entries(workerHours)
              .sort((a, b) => b[1] - a[1])
              .map(([name, mins]) => `
                <tr style="border-bottom: 1px solid #dee2e6;">
                  <td style="padding: 10px;">${name}</td>
                  <td style="padding: 10px; text-align: right;">${(mins / 60).toFixed(1)} hrs</td>
                </tr>
              `).join('')}
          </table>
        </div>

        <p style="color: #999; font-size: 12px; text-align: center; margin-top: 30px;">
          Sent by Punch'd Time & Attendance System
        </p>
      </div>
    `;

    await this.sendEmail(toEmail, `Weekly Report - ${new Date().toLocaleDateString()}`, html);
    return { success: true, message: 'Weekly report sent!' };
  }

  async sendOvertimeAlert(toEmail: string, workerName: string, totalHours: number) {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #dc3545;">Overtime Alert</h1>
        <p><strong>${workerName}</strong> has exceeded 40 hours this week.</p>
        <p style="font-size: 24px; color: #dc3545;"><strong>${totalHours.toFixed(1)} hours</strong></p>
        <p>Overtime hours: <strong>${(totalHours - 40).toFixed(1)} hours</strong></p>
        <p>Estimated overtime cost: <strong>$${((totalHours - 40) * 15).toFixed(2)}</strong></p>
        <hr />
        <p style="color: #999; font-size: 12px;">Punch'd Time & Attendance System</p>
      </div>
    `;

    await this.sendEmail(toEmail, `Overtime Alert: ${workerName}`, html);
    return { success: true };
  }

  async sendBuddyPunchAlert(
    toEmail: string,
    workerName: string,
    workerPhone: string,
    jobSiteName: string,
    confidence: number,
    photoUrl: string,
  ) {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #dc3545; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
          <h1 style="margin: 0;">BUDDY PUNCH ATTEMPT DETECTED</h1>
        </div>
        
        <div style="background: #f8d7da; padding: 20px; border: 1px solid #f5c6cb; border-top: none;">
          <p style="font-size: 18px; margin-top: 0;">
            A clock-in attempt was <strong>BLOCKED</strong> due to face verification failure.
          </p>
          
          <div style="background: white; padding: 15px; border-radius: 8px; margin: 15px 0;">
            <h3 style="margin-top: 0; color: #333;">Details</h3>
            <table style="width: 100%;">
              <tr>
                <td style="padding: 8px 0; color: #666;"><strong>Worker Account:</strong></td>
                <td style="padding: 8px 0;">${workerName}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #666;"><strong>Phone:</strong></td>
                <td style="padding: 8px 0;">${workerPhone}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #666;"><strong>Job Site:</strong></td>
                <td style="padding: 8px 0;">${jobSiteName}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #666;"><strong>Time:</strong></td>
                <td style="padding: 8px 0;">${new Date().toLocaleString()}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #666;"><strong>Face Match:</strong></td>
                <td style="padding: 8px 0; color: #dc3545;"><strong>${confidence.toFixed(1)}%</strong> (Required: 80%)</td>
              </tr>
            </table>
          </div>

          <div style="background: white; padding: 15px; border-radius: 8px; margin: 15px 0;">
            <h3 style="margin-top: 0; color: #333;">Submitted Photo</h3>
            <p style="color: #666; font-size: 14px;">The person who attempted to clock in:</p>
            <img src="${photoUrl}" alt="Clock-in attempt photo" style="max-width: 100%; border-radius: 8px; border: 2px solid #dc3545;" />
          </div>

          <div style="background: #fff3cd; padding: 15px; border-radius: 8px; border-left: 4px solid #ffc107;">
            <h4 style="margin-top: 0; color: #856404;">Recommended Action</h4>
            <ul style="margin-bottom: 0; color: #856404;">
              <li>Review the submitted photo above</li>
              <li>Contact ${workerName} to verify the situation</li>
              <li>Consider reviewing other recent clock-ins for this worker</li>
              <li>If confirmed buddy punching, take appropriate disciplinary action</li>
            </ul>
          </div>
        </div>

        <div style="background: #333; color: #999; padding: 15px; border-radius: 0 0 8px 8px; text-align: center;">
          <p style="margin: 0; font-size: 12px;">
            Punch'd Time & Attendance System<br />
            This is an automated security alert
          </p>
        </div>
      </div>
    `;

    await this.sendEmail(toEmail, `ALERT: Buddy Punch Attempt Blocked - ${workerName}`, html);
    console.log(`📧 Buddy punch alert sent to ${toEmail}`);
    return { success: true };
  }
}
