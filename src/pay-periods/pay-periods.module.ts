import { Module } from '@nestjs/common';
import { PayPeriodsController } from './pay-periods.controller';
import { PayPeriodsService } from './pay-periods.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [PayPeriodsController],
  providers: [PayPeriodsService],
  exports: [PayPeriodsService],
})
export class PayPeriodsModule {}
