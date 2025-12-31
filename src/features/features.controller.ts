import { Controller, Get, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { getAllowedFeatures, FEATURE_FLAGS } from './features';

@ApiTags('Features')
@Controller('features')
export class FeaturesController {
  constructor(private prisma: PrismaService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get allowed features for current subscription' })
  async getFeatures(@Request() req) {
    const company = await this.prisma.company.findUnique({
      where: { id: req.user.companyId },
    });

    const tier = company?.subscriptionTier || 'trial';
    const allowedFeatures = getAllowedFeatures(tier);

    return {
      tier,
      features: allowedFeatures,
      featureFlags: Object.keys(FEATURE_FLAGS).reduce((acc, feature) => {
        acc[feature] = allowedFeatures.includes(feature as any);
        return acc;
      }, {} as Record<string, boolean>),
    };
  }
}