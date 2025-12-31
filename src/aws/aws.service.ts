import { Injectable } from '@nestjs/common';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { RekognitionClient, CompareFacesCommand } from '@aws-sdk/client-rekognition';
import * as crypto from 'crypto';

@Injectable()
export class AwsService {
  private s3Client: S3Client;
  private rekognitionClient: RekognitionClient;
  private bucketName: string;
  private region: string;

  constructor() {
    this.region = process.env.AWS_REGION || 'us-east-2';
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID || '';
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY || '';
    this.bucketName = process.env.AWS_S3_BUCKET || '';

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
  }

  async uploadPhoto(base64Photo: string, userId: string, type: 'clock-in' | 'clock-out'): Promise<string> {
    // Remove base64 prefix if present
    const base64Data = base64Photo.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    // Generate unique filename
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

    // Return public URL
    return `https://${this.bucketName}.s3.${this.region}.amazonaws.com/${filename}`;
  }

  async compareFaces(sourceImageUrl: string, targetImageUrl: string): Promise<number> {
    try {
      // Extract S3 keys from URLs
      const sourceKey = this.extractKeyFromUrl(sourceImageUrl);
      const targetKey = this.extractKeyFromUrl(targetImageUrl);

      console.log('Comparing faces...');
      console.log('Source key:', sourceKey);
      console.log('Target key:', targetKey);

      // Use S3 object references directly (more reliable than downloading)
      const command = new CompareFacesCommand({
        SourceImage: {
          S3Object: {
            Bucket: this.bucketName,
            Name: sourceKey,
          },
        },
        TargetImage: {
          S3Object: {
            Bucket: this.bucketName,
            Name: targetKey,
          },
        },
        SimilarityThreshold: 80,
      });

      const response = await this.rekognitionClient.send(command);

      if (response.FaceMatches && response.FaceMatches.length > 0) {
        const similarity = response.FaceMatches[0].Similarity;
        console.log('Face match found! Similarity:', similarity);
        return similarity !== undefined ? similarity : 0;
      }

      console.log('No face match found');
      return 0;
    } catch (error) {
      console.error('Rekognition error:', error.message);
      throw error;
    }
  }

  private extractKeyFromUrl(url: string): string {
    // URL format: https://bucket.s3.region.amazonaws.com/key
    const urlParts = url.split('.amazonaws.com/');
    if (urlParts.length > 1) {
      return decodeURIComponent(urlParts[1]);
    }
    return url;
  }
}