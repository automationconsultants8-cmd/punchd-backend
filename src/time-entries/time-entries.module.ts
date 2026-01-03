import { Module } from '@nestjs/common';
import { TimeEntriesController } from './time-entries.controller';
import { TimeEntriesService } from './time-entries.service';
import { PrismaModule } from '../prisma/prisma.module';
import { JobsModule } from '../jobs/jobs.module';
import { AwsModule } from '../aws/aws.module';
import { EmailModule } from '../email/email.module';
import { AuditModule } from '../audit/audit.module';
import { BreakComplianceModule } from '../break-compliance/break-compliance.module';

@Module({
  imports: [PrismaModule, JobsModule, AwsModule, EmailModule, AuditModule, BreakComplianceModule],
  controllers: [TimeEntriesController],
  providers: [TimeEntriesService],
  exports: [TimeEntriesService],
})
export class TimeEntriesModule {}
