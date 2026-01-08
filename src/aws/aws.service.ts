import { Injectable } from '@nestjs/common';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
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

    return `https://${this.bucketName}.s3.${this.region}.amazonaws.com/${filename}`;
  }

  async compareFaces(sourceImage: string, targetImage: string): Promise<number> {
    try {
      console.log('Comparing faces...');
      
      // Convert base64 to buffer for both images
      const sourceBuffer = this.base64ToBuffer(sourceImage);
      const targetBuffer = this.base64ToBuffer(targetImage);

      const command = new CompareFacesCommand({
        SourceImage: {
          Bytes: sourceBuffer,
        },
        TargetImage: {
          Bytes: targetBuffer,
        },
        SimilarityThreshold: 80,
      });

      const response = await this.rekognitionClient.send(command);

      if (response.FaceMatches && response.FaceMatches.length > 0) {
        const similarity = response.FaceMatches[0].Similarity;
        console.log('Face match found! Similarity:', similarity);
        return similarity !== undefined ? similarity : 0;
      }

      console.log('No face match found - faces do not match');
      return 0;
    } catch (error) {
      console.error('Rekognition error:', error.message);
      throw error;
    }
  }

  private base64ToBuffer(input: string): Buffer {
    // Check if it's a base64 data URL
    if (input.startsWith('data:image')) {
      const base64Data = input.replace(/^data:image\/\w+;base64,/, '');
      return Buffer.from(base64Data, 'base64');
    }
    
    // Check if it's an S3 URL (legacy)
    if (input.startsWith('https://')) {
      throw new Error('S3 URLs no longer supported - use base64');
    }
    
    // Assume it's raw base64
    return Buffer.from(input, 'base64');
  }
}
