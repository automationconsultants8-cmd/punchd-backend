import { Injectable } from '@nestjs/common';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { RekognitionClient, CompareFacesCommand } from '@aws-sdk/client-rekognition';
import * as crypto from 'crypto';

@Injectable()
export class AwsService {
  private s3Client: S3Client | null = null;
  private rekognitionClient: RekognitionClient | null = null;
  private bucketName: string;
  private region: string;
  private isConfigured: boolean = false;

  constructor() {
    this.region = process.env.AWS_REGION || 'us-west-1';
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID || '';
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY || '';
    this.bucketName = process.env.AWS_S3_BUCKET || '';

    // Check if AWS is properly configured
    if (accessKeyId && secretAccessKey) {
      this.isConfigured = true;
      
      this.s3Client = new S3Client({
        region: this.region,
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
      });

      this.rekognitionClient = new RekognitionClient({
        region: this.region,
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
      });

      console.log('✅ AWS configured successfully');
      console.log(`   Region: ${this.region}`);
      console.log(`   Bucket: ${this.bucketName || 'NOT SET'}`);
    } else {
      console.warn('⚠️ AWS credentials not configured - face verification disabled');
      console.warn('   Set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, AWS_S3_BUCKET');
    }
  }

  isAwsConfigured(): boolean {
    return this.isConfigured;
  }

  async uploadPhoto(base64Photo: string, userId: string, type: 'clock-in' | 'clock-out'): Promise<string> {
    if (!this.isConfigured || !this.s3Client) {
      console.warn('AWS not configured - skipping photo upload');
      return 'aws-not-configured';
    }

    if (!this.bucketName) {
      console.warn('S3 bucket not configured - skipping photo upload');
      return 'bucket-not-configured';
    }

    try {
      const base64Data = base64Photo.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');

      const timestamp = Date.now();
      const random = crypto.randomBytes(8).toString('hex');
      const filename = `${userId}/${type}/${timestamp}-${random}.jpg`;

      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: filename,
        Body: buffer,
        ContentType: 'image/jpeg',
      });

      await this.s3Client.send(command);
      
      const url = `https://${this.bucketName}.s3.${this.region}.amazonaws.com/${filename}`;
      console.log(`📸 Photo uploaded: ${filename}`);
      return url;
    } catch (error) {
      console.error('S3 upload error:', error.message);
      throw error;
    }
  }

  async compareFaces(sourceImage: string, targetImage: string): Promise<number> {
    if (!this.isConfigured || !this.rekognitionClient) {
      console.warn('AWS not configured - skipping face comparison, auto-approving');
      return 100; // Return 100% match if AWS not configured (auto-approve)
    }

    try {
      console.log('🔍 Comparing faces...');

      // Convert base64 to buffer for both images
      const sourceBuffer = this.base64ToBuffer(sourceImage);
      const targetBuffer = this.base64ToBuffer(targetImage);

      if (!sourceBuffer || sourceBuffer.length === 0) {
        console.error('Source image is empty or invalid');
        throw new Error('Invalid source image');
      }

      if (!targetBuffer || targetBuffer.length === 0) {
        console.error('Target image is empty or invalid');
        throw new Error('Invalid target image');
      }

      console.log(`   Source image size: ${sourceBuffer.length} bytes`);
      console.log(`   Target image size: ${targetBuffer.length} bytes`);

      const command = new CompareFacesCommand({
        SourceImage: {
          Bytes: sourceBuffer,
        },
        TargetImage: {
          Bytes: targetBuffer,
        },
        SimilarityThreshold: 70, // Lower threshold to detect faces, we check 80% in code
      });

      const response = await this.rekognitionClient.send(command);

      if (response.FaceMatches && response.FaceMatches.length > 0) {
        const similarity = response.FaceMatches[0].Similarity;
        console.log(`✅ Face match found! Similarity: ${similarity?.toFixed(1)}%`);
        return similarity !== undefined ? similarity : 0;
      }

      // Check if faces were detected but didn't match
      if (response.UnmatchedFaces && response.UnmatchedFaces.length > 0) {
        console.log('❌ Face detected but does NOT match reference photo');
        return 0;
      }

      console.log('❌ No face match found');
      return 0;
    } catch (error) {
      console.error('❌ Rekognition error:', error.message);
      
      // Log more details for debugging
      if (error.name === 'InvalidParameterException') {
        console.error('   Invalid image format or no face detected in image');
      } else if (error.name === 'AccessDeniedException') {
        console.error('   AWS credentials do not have Rekognition permissions');
      } else if (error.name === 'ProvisionedThroughputExceededException') {
        console.error('   AWS Rekognition rate limit exceeded');
      }
      
      throw error;
    }
  }

  private base64ToBuffer(input: string): Buffer {
    if (!input) {
      throw new Error('Empty image input');
    }

    // Check if it's a base64 data URL (data:image/jpeg;base64,...)
    if (input.startsWith('data:image')) {
      const base64Data = input.replace(/^data:image\/\w+;base64,/, '');
      return Buffer.from(base64Data, 'base64');
    }

    // Check if it's an S3 URL - we can't use these directly anymore
    if (input.startsWith('https://') || input.startsWith('http://')) {
      console.error('Cannot compare S3 URLs directly - need base64 data');
      throw new Error('S3 URLs not supported - reference photo needs to be re-captured');
    }

    // Check if it's a placeholder
    if (input === 'verified-locally' || input === 'aws-not-configured' || input === 'bucket-not-configured') {
      throw new Error('No valid reference photo - user needs to re-register');
    }

    // Assume it's raw base64
    return Buffer.from(input, 'base64');
  }
}
