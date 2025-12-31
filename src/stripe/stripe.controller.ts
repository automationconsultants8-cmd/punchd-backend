import { Controller, Post, Get, Body, Req, UseGuards, Headers, RawBodyRequest, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { Request } from 'express';
import { StripeService } from './stripe.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@ApiTags('Billing')
@Controller('billing')
export class StripeController {
  constructor(private stripeService: StripeService) {}

  @Post('create-checkout-session')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create Stripe checkout session' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        planId: { type: 'string', enum: ['starter', 'professional', 'enterprise'] },
        billingCycle: { type: 'string', enum: ['monthly', 'yearly'] },
        workerCount: { type: 'number' },
      },
      required: ['planId', 'billingCycle', 'workerCount'],
    },
  })
  async createCheckoutSession(
    @Req() req: any,
    @Body() body: { planId: string; billingCycle: 'monthly' | 'yearly'; workerCount: number },
  ) {
    const { planId, billingCycle, workerCount } = body;

    if (!planId || !billingCycle || !workerCount) {
      throw new BadRequestException('planId, billingCycle, and workerCount are required');
    }

    return this.stripeService.createCheckoutSession(
      req.user.companyId, 
      req.user.userId,
      planId,
      billingCycle,
      workerCount,
    );
  }

  @Post('create-portal-session')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create Stripe customer portal session' })
  async createPortalSession(@Req() req: any) {
    return this.stripeService.createPortalSession(req.user.companyId);
  }

  @Get('status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get subscription status' })
  async getStatus(@Req() req: any) {
    return this.stripeService.getSubscriptionStatus(req.user.companyId);
  }

  @Post('webhook')
  @ApiOperation({ summary: 'Stripe webhook endpoint' })
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ) {
    if (!req.rawBody) {
      throw new BadRequestException('Missing raw body');
    }
    return this.stripeService.handleWebhook(req.rawBody, signature);
  }
}