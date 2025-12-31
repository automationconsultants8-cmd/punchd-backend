import { Controller, Get, Patch, Param, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ViolationsService } from './violations.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Violations')
@Controller('violations')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ViolationsController {
  constructor(private readonly violationsService: ViolationsService) {}

  @Get()
  @ApiOperation({ summary: 'Get all violations with filters' })
  findAll(
    @Request() req,
    @Query('userId') userId?: string,
    @Query('reviewed') reviewed?: string,
    @Query('severity') severity?: 'LOW' | 'MEDIUM' | 'HIGH',
  ) {
    return this.violationsService.findAll(req.user.companyId, {
      userId,
      reviewed: reviewed === 'true' ? true : reviewed === 'false' ? false : undefined,
      severity,
    });
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get violation statistics' })
  getStats(@Request() req) {
    return this.violationsService.getViolationStats(req.user.companyId);
  }

  @Patch(':id/review')
  @ApiOperation({ summary: 'Mark violation as reviewed' })
  markAsReviewed(@Request() req, @Param('id') id: string) {
    return this.violationsService.markAsReviewed(req.user.companyId, id, req.user.userId);
  }
}
