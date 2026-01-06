import { Module } from '@nestjs/common';
import { ShiftRequestsService } from './shift-requests.service';
import { ShiftRequestsController } from './shift-requests.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [PrismaModule, AuditModule, NotificationsModule],
  controllers: [ShiftRequestsController],
  providers: [ShiftRequestsService],
  exports: [ShiftRequestsService],
})
export class ShiftRequestsModule {}
