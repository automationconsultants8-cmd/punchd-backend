import { Controller, Get, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { getAllowedFeatures, getRequiredTier, FEATURE_FLAGS, FeatureFlag } from './features';

@Controller('features')
@UseGuards(JwtAuthGuard)
export class FeaturesController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async getFeatures(@Request() req) {
    const company = await this.prisma.company.findUnique({
      where: { id: req.user.companyId },
    });

    const tier = company?.subscriptionTier || 'trial';
    const allowedFeatures = getAllowedFeatures(tier);

    // Build feature map with access info
    const featureMap: Record<string, { allowed: boolean; requiredTier: string }> = {};
    
    for (const feature of Object.keys(FEATURE_FLAGS) as FeatureFlag[]) {
      featureMap[feature] = {
        allowed: allowedFeatures.includes(feature),
        requiredTier: getRequiredTier(feature),
      };
    }

    return {
      currentTier: tier,
      features: featureMap,
      allowedFeatures,
    };
  }
}
