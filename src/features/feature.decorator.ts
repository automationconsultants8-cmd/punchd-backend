import { SetMetadata } from '@nestjs/common';
import { FeatureFlag } from './features';

export const RequiresFeature = (feature: FeatureFlag) => SetMetadata('feature', feature);
