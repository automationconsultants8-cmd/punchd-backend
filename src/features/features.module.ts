import { Module, Global } from '@nestjs/common';
import { FeaturesController } from './features.controller';
import { FeatureGuard } from './feature.guard';
import { PrismaModule } from '../prisma/prisma.module';

@Global()
@Module({
  imports: [PrismaModule],
  controllers: [FeaturesController],
  providers: [FeatureGuard],
  exports: [FeatureGuard],
})
export class FeaturesModule {}
