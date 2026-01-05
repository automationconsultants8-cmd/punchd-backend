import { Module } from '@nestjs/common';
import { ShiftRequestsController } from './shift-requests.controller';
import { ShiftRequestsService } from './shift-requests.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [ShiftRequestsController],
  providers: [ShiftRequestsService],
  exports: [ShiftRequestsService],
})
export class ShiftRequestsModule {}
