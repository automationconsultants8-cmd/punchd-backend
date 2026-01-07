import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { AwsService } from '../aws/aws.service';
import { hasFeature } from '../features/features';

@Injectable()
export class FaceRecognitionService {
  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
    private awsService: AwsService,
  ) {}

  async compareFaces(
    companyId: string,
    userId: string,
    clockInPhotoUrl: string,
  ): Promise<{
    matched: boolean;
    confidence: number;
    skipped: boolean;
    reason?: string;
  }> {
    // Check if company has face verification feature
    const hasAccess = await this.checkFeatureAccess(companyId);
    if (!hasAccess) {
      console.log(`Face verification skipped - company ${companyId} on Starter plan`);
      return {
        matched: true,
        confidence: 0,
        skipped: true,
        reason: 'Feature not included in current plan',
      };
    }

    // Get user's reference photo
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { referencePhotoUrl: true, name: true },
    });

    if (!user?.referencePhotoUrl) {
      console.log(`No reference photo for user ${userId}, skipping face verification`);
      return {
        matched: true,
        confidence: 0,
        skipped: true,
        reason: 'No reference photo on file',
      };
    }

    try {
      // Compare faces using AWS Rekognition
      const similarity = await this.awsService.compareFaces(
        user.referencePhotoUrl,
        clockInPhotoUrl,
      );

      const matched = similarity >= 80;
      console.log(`Face verification for ${user.name}: ${matched ? 'MATCH' : 'NO MATCH'} (${similarity.toFixed(1)}%)`);

      return {
        matched,
        confidence: similarity,
        skipped: false,
      };
    } catch (error) {
      console.error('Face verification error:', error.message);
      // On error, allow clock-in but flag it
      return {
        matched: true,
        confidence: 0,
        skipped: true,
        reason: `Verification error: ${error.message}`,
      };
    }
  }

  async uploadReferencePhoto(userId: string, base64Photo: string): Promise<string> {
    const photoUrl = await this.awsService.uploadPhoto(base64Photo, userId, 'reference' as any);
    
    await this.prisma.user.update({
      where: { id: userId },
      data: { referencePhotoUrl: photoUrl },
    });

    return photoUrl;
  }

  private async checkFeatureAccess(companyId: string): Promise<boolean> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { subscriptionTier: true },
    });

    if (!company) return false;

    const tier = company.subscriptionTier || 'trial';
    return hasFeature(tier, 'FACE_VERIFICATION');
  }
}
