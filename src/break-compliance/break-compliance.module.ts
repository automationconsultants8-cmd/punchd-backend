import { Module } from '@nestjs/common';
import { BreakComplianceService } from './break-compliance.service';
import { BreakComplianceController } from './break-compliance.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [BreakComplianceController],
  providers: [BreakComplianceService],
  exports: [BreakComplianceService],
})
export class BreakComplianceModule {}
