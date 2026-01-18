import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TasksService } from './tasks.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [ScheduleModule.forRoot(), PrismaModule, AuditModule],
  providers: [TasksService],
})
export class TasksModule {}
