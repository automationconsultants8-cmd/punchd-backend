import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DocumentsService {
  constructor(private prisma: PrismaService) {}

  // Get documents for a user
  async getMyDocuments(userId: string, companyId: string) {
    return this.prisma.document.findMany({
      where: { userId, companyId },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Get all documents for company (admin)
  async getAllForCompany(companyId: string) {
    return this.prisma.document.findMany({
      where: { companyId },
      include: {
        user: {
          select: { id: true, name: true, email: true, phone: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Get document by ID
  async getById(id: string, userId: string, companyId: string) {
    const doc = await this.prisma.document.findFirst({
      where: { id, companyId },
      include: {
        user: { select: { id: true, name: true } },
      },
    });

    if (!doc) {
      throw new NotFoundException('Document not found');
    }

    // Check access - user can see their own, admin can see all
    if (doc.userId !== userId) {
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (user?.role === 'WORKER') {
        throw new ForbiddenException('Access denied');
      }
    }

    return doc;
  }

  // Upload document
  async upload(userId: string, companyId: string, file: Express.Multer.File, body: any) {
    if (!file) {
      throw new Error('No file provided');
    }

    return this.prisma.document.create({
      data: {
        userId,
        companyId,
        filename: file.originalname,
        name: body?.name || file.originalname,
        type: body?.type || 'OTHER',
        mimeType: file.mimetype,
        fileSize: file.size,
        fileData: file.buffer,
      },
    });
  }

  // Delete document
  async delete(id: string, userId: string, companyId: string) {
    const doc = await this.prisma.document.findFirst({
      where: { id, companyId },
    });

    if (!doc) {
      throw new NotFoundException('Document not found');
    }

    // Only owner or admin can delete
    if (doc.userId !== userId) {
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (user?.role === 'WORKER') {
        throw new ForbiddenException('Access denied');
      }
    }

    await this.prisma.document.delete({ where: { id } });
    return { success: true };
  }
}
