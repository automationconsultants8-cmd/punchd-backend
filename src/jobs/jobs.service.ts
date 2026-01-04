import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateJobDto, UpdateJobDto } from './dto';
import { Decimal } from '@prisma/client/runtime/library';
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
        defaultHourlyRate: dto.defaultHourlyRate ? new Decimal(dto.defaultHourlyRate) : null,
        isPrevailingWage: dto.isPrevailingWage || false,
        projectNumber: dto.projectNumber || null,
        contractNumber: dto.contractNumber || null,
        wageDecisionNumber: dto.wageDecisionNumber || null,
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

    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.address !== undefined) updateData.address = dto.address;
    if (dto.latitude !== undefined && dto.longitude !== undefined) {
      updateData.geofenceCenter = `${dto.latitude},${dto.longitude}`;
    }
    if (dto.geofenceRadiusMeters !== undefined) {
      updateData.geofenceRadiusMeters = dto.geofenceRadiusMeters;
    }
    if (dto.isActive !== undefined) {
      updateData.isActive = dto.isActive;
    }
    if (dto.defaultHourlyRate !== undefined) {
      updateData.defaultHourlyRate = dto.defaultHourlyRate ? new Decimal(dto.defaultHourlyRate) : null;
    }
    if (dto.isPrevailingWage !== undefined) {
      updateData.isPrevailingWage = dto.isPrevailingWage;
    }
    if (dto.projectNumber !== undefined) {
      updateData.projectNumber = dto.projectNumber || null;
    }
    if (dto.contractNumber !== undefined) {
      updateData.contractNumber = dto.contractNumber || null;
    }
    if (dto.wageDecisionNumber !== undefined) {
      updateData.wageDecisionNumber = dto.wageDecisionNumber || null;
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
