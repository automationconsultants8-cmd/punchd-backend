import { SetMetadata } from '@nestjs/common';
import { FeatureFlag } from './features';

export const RequireFeature = (feature: FeatureFlag) => SetMetadata('feature', feature);