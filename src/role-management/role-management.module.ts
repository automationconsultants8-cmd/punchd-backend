import { Module } from '@nestjs/common';
import { RoleManagementController } from './role-management.controller';
import { RoleManagementService } from './role-management.service';
import { PrismaModule } from '../prisma/prisma.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [PrismaModule, EmailModule],
  controllers: [RoleManagementController],
  providers: [RoleManagementService],
  exports: [RoleManagementService],
})
export class RoleManagementModule {}
