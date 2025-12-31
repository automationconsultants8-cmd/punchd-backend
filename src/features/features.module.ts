import { Module, Global } from '@nestjs/common';
import { FeatureGuard } from './feature.guard';
import { FeaturesController } from './features.controller';

@Global()
@Module({
  controllers: [FeaturesController],
  providers: [FeatureGuard],
  exports: [FeatureGuard],
})
export class FeaturesModule {}