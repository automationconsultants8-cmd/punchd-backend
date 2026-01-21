import { Module } from '@nestjs/common';
import { ShiftTemplatesController } from './shift-templates.controller';
import { ShiftTemplatesService } from './shift-templates.service';
import { PrismaService } from '../prisma.service';

@Module({
  controllers: [ShiftTemplatesController],
  providers: [ShiftTemplatesService, PrismaService],
  exports: [ShiftTemplatesService],
})
export class ShiftTemplatesModule {}
