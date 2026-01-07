// ============================================
// FILE: src/stripe/stripe.service.ts (BACKEND)
// ACTION: REPLACE ENTIRE FILE
// ============================================

import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import Stripe from 'stripe';

// Price IDs from Stripe Dashboard
const PRICE_IDS = {
  starter: {
    monthly: 'price_1SmUUsQXF9jw9z1yzAFwL1B9',
    yearly: 'price_1SmUVEQXF9jw9z1yZTA0m6V6',
  },
  professional: {
    monthly: 'price_1SmUVrQXF9jw9z1yZ27dYCBr',
    yearly: 'price_1SmUWBQXF9jw9z1yvOo4nC43',
  },
  contractor: {
    monthly: 'price_1SmUWUQXF9jw9z1y7TqMc3mN',
    yearly: 'price_1SmUWtQXF9jw9z1yhgdtms00',
  },
};

// Setup fee price IDs (one-time charges)
const SETUP_FEE_IDS = {
  starter: 'price_1SmUXCQXF9jw9z1yowceibih',
  professional: 'price_1SmUXaQXF9jw9z1ytekwjdnM',
  contractor: null, // No setup fee for contractor
};

// Minimum users per plan
const MINIMUM_USERS = {
  starter: 5,
  professional: 5,
  contractor: 10,
};

@Injectable()
export class StripeService {
  private stripe: Stripe;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    this.stripe = new Stripe(this.configService.get('STRIPE_SECRET_KEY') || '', {
      apiVersion: '2024-12-18.acacia' as any,
    });
  }

  async createCheckoutSession(
    companyId: string, 
    userId: string, 
    planId: string, 
    billingCycle: 'monthly' | 'yearly',
    requestedWorkerCount: number
  ) {
    // Validate plan
    if (!['starter', 'professional', 'contractor'].includes(planId)) {
      throw new BadRequestException('Invalid plan selected');
    }

    // Validate billing cycle
    if (!['monthly', 'yearly'].includes(billingCycle)) {
      throw new BadRequestException('Invalid billing cycle');
    }

    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
    });

    if (!company) {
      throw new BadRequestException('Company not found');
    }

    // Get user who initiated checkout
    const initiatingUser = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    // Calculate quantity (use requested count, but enforce minimum)
    const minimumUsers = MINIMUM_USERS[planId as keyof typeof MINIMUM_USERS];
    const quantity = Math.max(requestedWorkerCount, minimumUsers);

    // Get price ID
    const priceId = PRICE_IDS[planId as keyof typeof PRICE_IDS][billingCycle];

    // Create or get Stripe customer
    let customerId = company.stripeCustomerId;

    if (!customerId) {
      const customer = await this.stripe.customers.create({
        email: initiatingUser?.email || undefined,
        name: company.name,
        metadata: {
          companyId: company.id,
        },
      });
      customerId = customer.id;

      await this.prisma.company.update({
        where: { id: companyId },
        data: { stripeCustomerId: customerId },
      });
    }

    // Build line items
    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
      {
        price: priceId,
        quantity: quantity,
      },
    ];

    // Add setup fee for monthly plans (waived for yearly)
    const setupFeeId = SETUP_FEE_IDS[planId as keyof typeof SETUP_FEE_IDS];
    if (billingCycle === 'monthly' && setupFeeId) {
      lineItems.push({
        price: setupFeeId,
        quantity: 1,
      });
    }

    // Create checkout session
    const session = await this.stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'subscription',
      success_url: `${this.configService.get('FRONTEND_URL') || 'http://localhost:5173'}/billing?success=true`,
      cancel_url: `${this.configService.get('FRONTEND_URL') || 'http://localhost:5173'}/billing?canceled=true`,
      metadata: {
        companyId: company.id,
        planId: planId,
        billingCycle: billingCycle,
        workerCount: quantity.toString(),
      },
      subscription_data: {
        metadata: {
          companyId: company.id,
          planId: planId,
        },
      },
      allow_promotion_codes: true,
    });

    console.log(`💳 Checkout session created for ${company.name} - Plan: ${planId}, Cycle: ${billingCycle}, Users: ${quantity}`);

    return { sessionId: session.id, url: session.url };
  }

  async createPortalSession(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
    });

    if (!company) {
      throw new BadRequestException('Company not found');
    }

    // Get owner
    const owner = await this.prisma.user.findFirst({
      where: { companyId, role: 'OWNER' },
    });

    let customerId = company.stripeCustomerId;

    if (!customerId) {
      const customer = await this.stripe.customers.create({
        email: owner?.email || undefined,
        name: company.name,
        metadata: {
          companyId: company.id,
        },
      });
      customerId = customer.id;

      await this.prisma.company.update({
        where: { id: companyId },
        data: { stripeCustomerId: customerId },
      });

      console.log(`💳 Created Stripe customer for ${company.name}`);
    }

    const session = await this.stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${this.configService.get('FRONTEND_URL') || 'http://localhost:5173'}/billing`,
    });

    return { url: session.url };
  }

  async handleWebhook(payload: Buffer, signature: string) {
    const webhookSecret = this.configService.get('STRIPE_WEBHOOK_SECRET');
    
    let event: Stripe.Event;

    try {
      if (webhookSecret) {
        event = this.stripe.webhooks.constructEvent(payload, signature, webhookSecret);
      } else {
        event = JSON.parse(payload.toString());
      }
    } catch (err: any) {
      console.error('❌ Webhook signature verification failed:', err.message);
      throw new BadRequestException('Webhook signature verification failed');
    }

    console.log(`📨 Stripe webhook: ${event.type}`);

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        await this.handleCheckoutComplete(session);
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        await this.handleSubscriptionUpdate(subscription);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        await this.handleSubscriptionCanceled(subscription);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        await this.handlePaymentFailed(invoice);
        break;
      }

      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice;
        await this.handleInvoicePaid(invoice);
        break;
      }
    }

    return { received: true };
  }

  private async handleCheckoutComplete(session: Stripe.Checkout.Session) {
    const companyId = session.metadata?.companyId;
    const planId = session.metadata?.planId || 'professional';
    
    if (!companyId) {
      console.error('No companyId in checkout session metadata');
      return;
    }

    await this.prisma.company.update({
      where: { id: companyId },
      data: {
        stripeSubscriptionId: session.subscription as string,
        subscriptionTier: planId,
        subscriptionStatus: 'active',
        trialEndsAt: null,
      },
    });

    console.log(`✅ Subscription activated for company ${companyId} - Plan: ${planId}`);
  }

  private async handleSubscriptionUpdate(subscription: Stripe.Subscription) {
    let company = await this.prisma.company.findFirst({
      where: { stripeSubscriptionId: subscription.id },
    });

    if (!company) {
      // Try to find by customer ID
      const customerId = subscription.customer as string;
      company = await this.prisma.company.findFirst({
        where: { stripeCustomerId: customerId },
      });

      if (company) {
        // Update with subscription ID
        await this.prisma.company.update({
          where: { id: company.id },
          data: { stripeSubscriptionId: subscription.id },
        });
      }
    }

    if (!company) {
      console.error('Company not found for subscription:', subscription.id);
      return;
    }

    const status = subscription.status === 'active' ? 'active' : 
                   subscription.status === 'past_due' ? 'past_due' : 
                   subscription.status === 'canceled' ? 'canceled' : 
                   subscription.status === 'trialing' ? 'trialing' : 'inactive';

    // Get plan from subscription metadata
    const planId = subscription.metadata?.planId || company.subscriptionTier;

    await this.prisma.company.update({
      where: { id: company.id },
      data: { 
        subscriptionStatus: status,
        subscriptionTier: planId,
      },
    });

    console.log(`🔄 Subscription updated for ${company.name}: ${status} (${planId})`);
  }

  private async handleSubscriptionCanceled(subscription: Stripe.Subscription) {
    const company = await this.prisma.company.findFirst({
      where: { stripeSubscriptionId: subscription.id },
    });

    if (!company) return;

    await this.prisma.company.update({
      where: { id: company.id },
      data: {
        subscriptionTier: 'canceled',
        subscriptionStatus: 'canceled',
        stripeSubscriptionId: null,
      },
    });

    console.log(`❌ Subscription canceled for ${company.name}`);
  }

  private async handlePaymentFailed(invoice: Stripe.Invoice) {
    const customerId = invoice.customer as string;
    
    const company = await this.prisma.company.findFirst({
      where: { stripeCustomerId: customerId },
    });

    if (!company) return;

    await this.prisma.company.update({
      where: { id: company.id },
      data: { subscriptionStatus: 'past_due' },
    });

    console.log(`⚠️ Payment failed for ${company.name}`);
  }

  private async handleInvoicePaid(invoice: Stripe.Invoice) {
    const customerId = invoice.customer as string;
    
    const company = await this.prisma.company.findFirst({
      where: { stripeCustomerId: customerId },
    });

    if (!company) return;

    await this.prisma.company.update({
      where: { id: company.id },
      data: { subscriptionStatus: 'active' },
    });

    console.log(`💰 Invoice paid for ${company.name}`);
  }

  async getSubscriptionStatus(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
    });

    if (!company) {
      throw new BadRequestException('Company not found');
    }

    // Count workers
    const workerCount = await this.prisma.user.count({
      where: { companyId },
    });

    const now = new Date();
    let daysRemaining: number | null = null;
    let isWarningPeriod = false;
    let trialExpired = false;

    // Check trial status
    if (company.subscriptionTier === 'trial' && company.trialEndsAt) {
      const trialEnd = new Date(company.trialEndsAt);
      const msRemaining = trialEnd.getTime() - now.getTime();
      daysRemaining = Math.ceil(msRemaining / (1000 * 60 * 60 * 24));

      if (daysRemaining <= 0) {
        trialExpired = true;
        daysRemaining = 0;
      } else if (daysRemaining <= 2) {
        // Warning period: 2 days or less remaining (day 12-13)
        isWarningPeriod = true;
      }
    }

    const isPaid = ['starter', 'professional', 'contractor'].includes(
      company.subscriptionTier?.toLowerCase() || ''
    );

    // Determine if subscription is active
    const isActive = isPaid || (company.subscriptionTier === 'trial' && !trialExpired);

    return {
      tier: company.subscriptionTier,
      status: company.subscriptionStatus,
      trialEndsAt: company.trialEndsAt,
      daysRemaining,
      isWarningPeriod,
      trialExpired,
      isActive,
      needsUpgrade: trialExpired || (!isPaid && company.subscriptionTier !== 'trial'),
      workerCount,
    };
  }
}
