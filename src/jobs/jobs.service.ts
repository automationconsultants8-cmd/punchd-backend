import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateJobDto, UpdateJobDto } from './dto';
import * as turf from '@turf/turf';

@Injectable()
export class JobsService {
  constructor(private prisma: PrismaService) {}

  async create(companyId: string, dto: CreateJobDto) {
    return this.prisma.job.create({
      data: {
        companyId,
        name: dto.name,
        address: dto.address,
        geofenceCenter: `${dto.latitude},${dto.longitude}`,
        geofenceRadiusMeters: dto.geofenceRadiusMeters || 100,
      },
    });
  }

  async findAll(companyId: string) {
    return this.prisma.job.findMany({
      where: { companyId, isActive: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(companyId: string, jobId: string) {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, companyId },
    });

    if (!job) {
      throw new NotFoundException('Job not found');
    }

    return job;
  }

  async update(companyId: string, jobId: string, dto: UpdateJobDto) {
    await this.findOne(companyId, jobId);

    const updateData: any = {};
    
    if (dto.name) updateData.name = dto.name;
    if (dto.address) updateData.address = dto.address;
    if (dto.latitude && dto.longitude) {
      updateData.geofenceCenter = `${dto.latitude},${dto.longitude}`;
    }
    if (dto.geofenceRadiusMeters) {
      updateData.geofenceRadiusMeters = dto.geofenceRadiusMeters;
    }
    if (typeof dto.isActive !== 'undefined') {
      updateData.isActive = dto.isActive;
    }

    return this.prisma.job.update({
      where: { id: jobId },
      data: updateData,
    });
  }

  async remove(companyId: string, jobId: string) {
    await this.findOne(companyId, jobId);

    return this.prisma.job.update({
      where: { id: jobId },
      data: { isActive: false },
    });
  }

  isWithinGeofence(
    jobLatitude: number,
    jobLongitude: number,
    radiusMeters: number,
    userLatitude: number,
    userLongitude: number,
  ): { isWithin: boolean; distance: number } {
    const from = turf.point([jobLongitude, jobLatitude]);
    const to = turf.point([userLongitude, userLatitude]);
    
    const distance = turf.distance(from, to, { units: 'meters' });
    
    return {
      isWithin: distance <= radiusMeters,
      distance: Math.round(distance),
    };
  }
}
