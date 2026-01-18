import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { Decimal } from '@prisma/client/runtime/library';

@Injectable()
export class CompanyService {
  constructor(private prisma: PrismaService) {}

  async findOne(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
    });
    if (!company) {
      throw new NotFoundException('Company not found');
    }
    return company;
  }

  async update(companyId: string, dto: UpdateCompanyDto) {
    const company = await this.findOne(companyId);
    const updateData: any = {};

    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.address !== undefined) updateData.address = dto.address;
    if (dto.city !== undefined) updateData.city = dto.city;
    if (dto.state !== undefined) updateData.state = dto.state;
    if (dto.zip !== undefined) updateData.zip = dto.zip;
    if (dto.defaultHourlyRate !== undefined) {
      updateData.defaultHourlyRate = dto.defaultHourlyRate 
        ? new Decimal(dto.defaultHourlyRate) 
        : null;
    }

    // Merge settings with existing settings (don't overwrite)
    if (dto.settings !== undefined) {
      const existingSettings = (company.settings as Record<string, any>) || {};
      updateData.settings = { ...existingSettings, ...dto.settings };
    }

    // Merge overtimeSettings with existing
    if (dto.overtimeSettings !== undefined) {
      const existingOT = (company.overtimeSettings as Record<string, any>) || {};
      updateData.overtimeSettings = { ...existingOT, ...dto.overtimeSettings };
    }

    // Merge breakComplianceSettings with existing
    if (dto.breakComplianceSettings !== undefined) {
      const existingBreak = (company.breakComplianceSettings as Record<string, any>) || {};
      updateData.breakComplianceSettings = { ...existingBreak, ...dto.breakComplianceSettings };
    }

    return this.prisma.company.update({
      where: { id: companyId },
      data: updateData,
    });
  }
}
