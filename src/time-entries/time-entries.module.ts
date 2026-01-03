import { Module } from '@nestjs/common';
import { TimeEntriesService } from './time-entries.service';
import { TimeEntriesController } from './time-entries.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { JobsModule } from '../jobs/jobs.module';
import { AwsModule } from '../aws/aws.module';
import { EmailModule } from '../email/email.module';
import { BreakComplianceModule } from '../break-compliance/break-compliance.module';

@Module({
  imports: [PrismaModule, JobsModule, AwsModule, EmailModule],
  controllers: [TimeEntriesController],
  providers: [TimeEntriesService],
})
export class TimeEntriesModule {}
