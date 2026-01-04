import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateCompanyDto } from './dto/update-company.dto';

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

    return this.prisma.company.update({
      where: { id: companyId },
      data: {
        name: dto.name ?? company.name,
        address: dto.address ?? company.address,
        city: dto.city ?? company.city,
        state: dto.state ?? company.state,
        zip: dto.zip ?? company.zip,
      },
    });
  }
}
