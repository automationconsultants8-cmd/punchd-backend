import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { JobsModule } from './jobs/jobs.module';
import { TimeEntriesModule } from './time-entries/time-entries.module';
import { ViolationsModule } from './violations/violations.module';
import { FaceRecognitionModule } from './face-recognition/face-recognition.module';
import { AwsModule } from './aws/aws.module';
import { EmailModule } from './email/email.module';
import { ShiftsModule } from './shifts/shifts.module';
import { AuditModule } from './audit/audit.module';
import { StripeModule } from './stripe/stripe.module';
import { FeaturesModule } from './features/features.module';
import { BreakComplianceModule } from './break-compliance/break-compliance.module';
import { CertifiedPayrollModule } from './certified-payroll/certified-payroll.module';
import { CompanyModule } from './company/company.module';
import { ShiftRequestsModule } from './shift-requests/shift-requests.module';
import { TimeOffModule } from './time-off/time-off.module';
import { MessagesModule } from './messages/messages.module';
import { NotificationsModule } from './notifications/notifications.module';
import { RoleManagementModule } from './role-management/role-management.module';
import { PayPeriodsModule } from './pay-periods/pay-periods.module';
import { LeaveModule } from './leave/leave.module';
import { TasksModule } from './tasks/tasks.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    PrismaModule,
    FeaturesModule,
    AuditModule,
    AuthModule,
    UsersModule,
    JobsModule,
    BreakComplianceModule,
    TimeEntriesModule,
    ViolationsModule,
    FaceRecognitionModule,
    AwsModule,
    EmailModule,
    ShiftsModule,
    StripeModule,
    CertifiedPayrollModule,
    CompanyModule,
    NotificationsModule,
    ShiftRequestsModule,
    TimeOffModule,
    MessagesModule,
    RoleManagementModule,
    PayPeriodsModule,
    LeaveModule,
    TasksModule,
  ],
})
export class AppModule {}
