import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class MessagesService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private notificationsService: NotificationsService,
  ) {}

  async create(data: {
    companyId: string;
    senderId: string;
    recipientId?: string;
    subject?: string;
    body: string;
    shiftRequestId?: string;
    timeOffRequestId?: string;
  }) {
    const message = await this.prisma.message.create({
      data: {
        companyId: data.companyId,
        senderId: data.senderId,
        recipientId: data.recipientId,
        subject: data.subject,
        body: data.body,
        shiftRequestId: data.shiftRequestId,
        timeOffRequestId: data.timeOffRequestId,
      },
      include: {
        sender: true,
        recipient: true,
      },
    });

    await this.auditService.log({
      companyId: data.companyId,
      userId: data.senderId,
      action: 'MESSAGE_SENT',
      targetType: 'Message',
      targetId: message.id,
      details: {
        recipientId: data.recipientId,
        subject: data.subject,
      },
    });

    // Send push notification to recipient
    if (data.recipientId) {
      const sender = await this.prisma.user.findUnique({
        where: { id: data.senderId },
        select: { name: true },
      });
      await this.notificationsService.notifyNewMessage(
        data.recipientId,
        sender?.name || 'Someone',
        data.subject,
      );
    }

    return message;
  }

  async findAll(companyId: string, userId: string, filters?: {
    isRead?: boolean;
    sent?: boolean;
  }) {
    const where: any = { companyId };

    if (filters?.sent) {
      // Sent messages: only messages I sent
      where.senderId = userId;
    } else {
      // Inbox: messages sent TO me, or broadcasts NOT sent by me
      where.OR = [
        { recipientId: userId },
        { 
          recipientId: null,
          senderId: { not: userId }
        },
      ];
    }

    if (filters?.isRead !== undefined) {
      where.isRead = filters.isRead;
    }

    return this.prisma.message.findMany({
      where,
      include: {
        sender: true,
        recipient: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findInbox(companyId: string, userId: string) {
    return this.findAll(companyId, userId, { sent: false });
  }

  async findSent(companyId: string, userId: string) {
    return this.findAll(companyId, userId, { sent: true });
  }

  async findUnread(companyId: string, userId: string) {
    return this.findAll(companyId, userId, { isRead: false });
  }

  async findOne(id: string, userId: string) {
    const message = await this.prisma.message.findUnique({
      where: { id },
      include: {
        sender: true,
        recipient: true,
      },
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    // Check if user has access
    if (message.senderId !== userId && message.recipientId !== userId && message.recipientId !== null) {
      throw new ForbiddenException('You do not have access to this message');
    }

    return message;
  }

  async markAsRead(id: string, userId: string) {
    const message = await this.findOne(id, userId);

    if (message.recipientId !== userId && message.recipientId !== null) {
      throw new ForbiddenException('You can only mark your own messages as read');
    }

    return this.prisma.message.update({
      where: { id },
      data: {
        isRead: true,
        readAt: new Date(),
      },
      include: {
        sender: true,
        recipient: true,
      },
    });
  }

  async markAllAsRead(companyId: string, userId: string) {
    return this.prisma.message.updateMany({
      where: {
        companyId,
        OR: [
          { recipientId: userId },
          { recipientId: null, senderId: { not: userId } },
        ],
        isRead: false,
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });
  }

  async getUnreadCount(companyId: string, userId: string) {
    return this.prisma.message.count({
      where: {
        companyId,
        OR: [
          { recipientId: userId },
          { recipientId: null, senderId: { not: userId } },
        ],
        isRead: false,
      },
    });
  }

  async findAdminMessages(companyId: string) {
    return this.prisma.message.findMany({
      where: {
        companyId,
        recipientId: null,
      },
      include: {
        sender: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async delete(id: string, userId: string, companyId: string) {
    const message = await this.prisma.message.findFirst({
      where: { id, companyId },
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    // User can delete if they sent it or received it
    if (message.senderId !== userId && message.recipientId !== userId && message.recipientId !== null) {
      throw new ForbiddenException('You can only delete your own messages');
    }

    await this.prisma.message.delete({
      where: { id },
    });

    return { success: true };
  }

    await this.auditService.log({
      companyId,
      userId,
      action: 'MESSAGE_DELETED',
      targetType: 'Message',
      targetId: id,
      details: {},
    });

    return { success: true };
  }
}
