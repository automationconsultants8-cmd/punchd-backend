import { Module } from '@nestjs/common';
import { CertifiedPayrollService } from './certified-payroll.service';
import { CertifiedPayrollController } from './certified-payroll.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [CertifiedPayrollController],
  providers: [CertifiedPayrollService],
  exports: [CertifiedPayrollService],
})
export class CertifiedPayrollModule {}
