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
    TimeEntriesModule,
    ViolationsModule,
    FaceRecognitionModule,
    AwsModule,
    EmailModule,
    ShiftsModule,
    StripeModule,
  ],
})
export class AppModule {}
