import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import Expo, { ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';

export interface NotificationPayload {
  title: string;
  body: string;
  data?: Record<string, any>;
  sound?: 'default' | null;
  badge?: number;
}

@Injectable()
export class NotificationsService {
  private expo: Expo;
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private prisma: PrismaService) {
    this.expo = new Expo();
  }

  // Register a push token for a user
  async registerToken(userId: string, token: string, platform: string) {
    // Validate the token format
    if (!Expo.isExpoPushToken(token)) {
      this.logger.warn(`Invalid Expo push token: ${token}`);
      throw new Error('Invalid push token format');
    }

    // Upsert the token (update if exists, create if not)
    return this.prisma.pushToken.upsert({
      where: {
        userId_token: { userId, token },
      },
      update: {
        isActive: true,
        platform,
        updatedAt: new Date(),
      },
      create: {
        userId,
        token,
        platform,
        isActive: true,
      },
    });
  }

  // Unregister a push token
  async unregisterToken(userId: string, token: string) {
    return this.prisma.pushToken.updateMany({
      where: { userId, token },
      data: { isActive: false },
    });
  }

  // Unregister all tokens for a user (on logout)
  async unregisterAllTokens(userId: string) {
    return this.prisma.pushToken.updateMany({
      where: { userId },
      data: { isActive: false },
    });
  }

  // Get active tokens for a user
  async getActiveTokens(userId: string): Promise<string[]> {
    const tokens = await this.prisma.pushToken.findMany({
      where: { userId, isActive: true },
      select: { token: true },
    });
    return tokens.map(t => t.token);
  }

  // Get active tokens for multiple users
  async getActiveTokensForUsers(userIds: string[]): Promise<Map<string, string[]>> {
    const tokens = await this.prisma.pushToken.findMany({
      where: { userId: { in: userIds }, isActive: true },
      select: { userId: true, token: true },
    });

    const tokenMap = new Map<string, string[]>();
    tokens.forEach(t => {
      const existing = tokenMap.get(t.userId) || [];
      existing.push(t.token);
      tokenMap.set(t.userId, existing);
    });
    return tokenMap;
  }

  // Send notification to a single user
  async sendToUser(userId: string, payload: NotificationPayload) {
    const tokens = await this.getActiveTokens(userId);
    if (tokens.length === 0) {
      this.logger.debug(`No active push tokens for user ${userId}`);
      return { sent: 0 };
    }
    return this.sendToTokens(tokens, payload);
  }

  // Send notification to multiple users
  async sendToUsers(userIds: string[], payload: NotificationPayload) {
    const tokenMap = await this.getActiveTokensForUsers(userIds);
    const allTokens: string[] = [];
    tokenMap.forEach(tokens => allTokens.push(...tokens));

    if (allTokens.length === 0) {
      this.logger.debug(`No active push tokens for users`);
      return { sent: 0 };
    }
    return this.sendToTokens(allTokens, payload);
  }

  // Send to specific tokens
  async sendToTokens(tokens: string[], payload: NotificationPayload) {
    // Filter valid tokens
    const validTokens = tokens.filter(token => Expo.isExpoPushToken(token));

    if (validTokens.length === 0) {
      return { sent: 0 };
    }

    // Build messages
    const messages: ExpoPushMessage[] = validTokens.map(token => ({
      to: token,
      sound: payload.sound || 'default',
      title: payload.title,
      body: payload.body,
      data: payload.data || {},
      badge: payload.badge,
    }));

    // Chunk messages (Expo recommends max 100 per request)
    const chunks = this.expo.chunkPushNotifications(messages);
    const tickets: ExpoPushTicket[] = [];

    for (const chunk of chunks) {
      try {
        const ticketChunk = await this.expo.sendPushNotificationsAsync(chunk);
        tickets.push(...ticketChunk);
      } catch (error) {
        this.logger.error(`Error sending push notifications: ${error.message}`);
      }
    }

    // Handle failed tokens (mark as inactive)
    await this.handleTicketErrors(validTokens, tickets);

    const successCount = tickets.filter(t => t.status === 'ok').length;
    this.logger.log(`Sent ${successCount}/${validTokens.length} push notifications`);

    return { sent: successCount, total: validTokens.length };
  }

  // Handle ticket errors and deactivate invalid tokens
  private async handleTicketErrors(tokens: string[], tickets: ExpoPushTicket[]) {
    for (let i = 0; i < tickets.length; i++) {
      const ticket = tickets[i];
      const token = tokens[i];

      if (ticket.status === 'error') {
        // If the token is invalid, mark it as inactive
        if (
          ticket.details?.error === 'DeviceNotRegistered' ||
          ticket.details?.error === 'InvalidCredentials'
        ) {
          this.logger.warn(`Deactivating invalid token: ${token}`);
          await this.prisma.pushToken.updateMany({
            where: { token },
            data: { isActive: false },
          });
        }
      }
    }
  }

  // =============================================
  // NOTIFICATION HELPERS FOR SPECIFIC EVENTS
  // =============================================

  // New message received
  async notifyNewMessage(recipientId: string, senderName: string, subject?: string) {
    return this.sendToUser(recipientId, {
      title: 'New Message',
      body: subject ? `${senderName}: ${subject}` : `New message from ${senderName}`,
      data: { type: 'message', screen: 'Messages' },
    });
  }

  // Shift request approved
  async notifyShiftRequestApproved(userId: string, shiftDate: string) {
    return this.sendToUser(userId, {
      title: 'Shift Request Approved',
      body: `Your shift request for ${shiftDate} has been approved.`,
      data: { type: 'shift_request', screen: 'ShiftRequests' },
    });
  }

  // Shift request declined
  async notifyShiftRequestDeclined(userId: string, shiftDate: string, reason?: string) {
    return this.sendToUser(userId, {
      title: 'Shift Request Declined',
      body: reason 
        ? `Your shift request for ${shiftDate} was declined: ${reason}`
        : `Your shift request for ${shiftDate} was declined.`,
      data: { type: 'shift_request', screen: 'ShiftRequests' },
    });
  }

  // Time off approved
  async notifyTimeOffApproved(userId: string, startDate: string, endDate: string) {
    const dateRange = startDate === endDate ? startDate : `${startDate} - ${endDate}`;
    return this.sendToUser(userId, {
      title: 'Time Off Approved',
      body: `Your time off request for ${dateRange} has been approved.`,
      data: { type: 'time_off', screen: 'TimeOff' },
    });
  }

  // Time off declined
  async notifyTimeOffDeclined(userId: string, startDate: string, reason?: string) {
    return this.sendToUser(userId, {
      title: 'Time Off Declined',
      body: reason 
        ? `Your time off request was declined: ${reason}`
        : `Your time off request for ${startDate} was declined.`,
      data: { type: 'time_off', screen: 'TimeOff' },
    });
  }

  // Schedule change / new shift assigned
  async notifyNewShift(userId: string, jobName: string, shiftDate: string, startTime: string) {
    return this.sendToUser(userId, {
      title: 'New Shift Assigned',
      body: `You've been scheduled at ${jobName} on ${shiftDate} at ${startTime}.`,
      data: { type: 'schedule', screen: 'Schedule' },
    });
  }

  // Shift cancelled
  async notifyShiftCancelled(userId: string, jobName: string, shiftDate: string) {
    return this.sendToUser(userId, {
      title: 'Shift Cancelled',
      body: `Your shift at ${jobName} on ${shiftDate} has been cancelled.`,
      data: { type: 'schedule', screen: 'Schedule' },
    });
  }

  // Time entry approved
  async notifyTimeEntryApproved(userId: string, date: string) {
    return this.sendToUser(userId, {
      title: 'Time Entry Approved',
      body: `Your time entry for ${date} has been approved.`,
      data: { type: 'time_entry', screen: 'WeeklySummary' },
    });
  }

  // Notify admins of new request (shift or time off)
  async notifyAdminsOfRequest(
    companyId: string, 
    requestType: 'shift' | 'time_off', 
    workerName: string
  ) {
    // Get all admin/manager users for this company
    const admins = await this.prisma.user.findMany({
      where: {
        companyId,
        role: { in: ['ADMIN', 'OWNER', 'MANAGER'] },
        isActive: true,
      },
      select: { id: true },
    });

    const adminIds = admins.map(a => a.id);
    if (adminIds.length === 0) return { sent: 0 };

    const title = requestType === 'shift' ? 'New Shift Request' : 'New Time Off Request';
    const body = requestType === 'shift'
      ? `${workerName} submitted a shift request.`
      : `${workerName} requested time off.`;

    return this.sendToUsers(adminIds, {
      title,
      body,
      data: { 
        type: requestType === 'shift' ? 'shift_request_admin' : 'time_off_admin',
        screen: requestType === 'shift' ? 'ShiftRequests' : 'TimeOff',
      },
    });
  }
}
