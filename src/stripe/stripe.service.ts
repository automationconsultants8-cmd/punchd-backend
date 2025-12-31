import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import Stripe from 'stripe';

// Price IDs from Stripe Dashboard
const PRICE_IDS = {
  starter: {
    monthly: 'price_1SkJx6QXF9jw9z1y1tqz3DC0',
    yearly: 'price_1SkJzLQXF9jw9z1yObbjuNAZ',
  },
  professional: {
    monthly: 'price_1SkJxeQXF9jw9z1yS4EpxI5C',
    yearly: 'price_1SkJziQXF9jw9z1yTDNSGBjl',
  },
  enterprise: {
    monthly: 'price_1SkJy8QXF9jw9z1yShbto2vr',
    yearly: 'price_1SkJzxQXF9jw9z1y8ffmsgvI',
  },
};

// Minimum users per plan
const MINIMUM_USERS = {
  starter: 10,
  professional: 10,
  enterprise: 25,
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
    if (!['starter', 'professional', 'enterprise'].includes(planId)) {
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

    // Create checkout session
    const session = await this.stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: quantity,
        },
      ],
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

    // Check if trial expired
    if (company.subscriptionTier === 'trial' && company.trialEndsAt) {
      if (new Date() > company.trialEndsAt) {
        return {
          tier: 'trial_expired',
          status: 'inactive',
          trialEndsAt: company.trialEndsAt,
          needsUpgrade: true,
          workerCount,
        };
      }
    }

    const isPaid = ['starter', 'professional', 'enterprise'].includes(company.subscriptionTier);

    return {
      tier: company.subscriptionTier,
      status: company.subscriptionStatus,
      trialEndsAt: company.trialEndsAt,
      needsUpgrade: !isPaid && company.subscriptionTier !== 'trial',
      workerCount,
    };
  }
}