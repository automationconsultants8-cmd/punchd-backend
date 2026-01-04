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
  ],
})
export class AppModule {}
