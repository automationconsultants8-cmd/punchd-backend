import { Controller, Get, Patch, Body, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CompanyService } from './company.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UpdateCompanyDto } from './dto/update-company.dto';

@ApiTags('Company')
@Controller('company')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class CompanyController {
  constructor(private readonly companyService: CompanyService) {}

  @Get()
  @ApiOperation({ summary: 'Get company details' })
  getCompany(@Request() req) {
    return this.companyService.findOne(req.user.companyId);
  }

  @Patch()
  @ApiOperation({ summary: 'Update company details' })
  updateCompany(@Request() req, @Body() dto: UpdateCompanyDto) {
    return this.companyService.update(req.user.companyId, dto);
  }
}
