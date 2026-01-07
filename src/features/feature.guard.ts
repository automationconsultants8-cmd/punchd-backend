import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import { hasFeature, getRequiredTier, FeatureFlag } from './features';

@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredFeature = this.reflector.get<FeatureFlag>('feature', context.getHandler());
    
    if (!requiredFeature) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || !user.companyId) {
      throw new ForbiddenException('User not authenticated');
    }

    const company = await this.prisma.company.findUnique({
      where: { id: user.companyId },
    });

    if (!company) {
      throw new ForbiddenException('Company not found');
    }

    const tier = company.subscriptionTier || 'trial';
    
    if (!hasFeature(tier, requiredFeature)) {
      const requiredTier = getRequiredTier(requiredFeature);
      throw new ForbiddenException({
        message: `This feature requires the ${requiredTier.charAt(0).toUpperCase() + requiredTier.slice(1)} plan or higher.`,
        feature: requiredFeature,
        currentTier: tier,
        requiredTier: requiredTier,
        upgradeUrl: '/billing',
      });
    }

    return true;
  }
}
