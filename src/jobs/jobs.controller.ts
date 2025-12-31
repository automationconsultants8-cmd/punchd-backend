import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JobsService } from './jobs.service';
import { CreateJobDto, UpdateJobDto } from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@ApiTags('Jobs')
@Controller('jobs')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Post()
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Create a new job site' })
  create(@Request() req, @Body() createJobDto: CreateJobDto) {
    return this.jobsService.create(req.user.companyId, createJobDto);
  }

  @Get()
  @Roles('OWNER', 'ADMIN', 'MANAGER', 'WORKER')
  @ApiOperation({ summary: 'Get all active job sites' })
  findAll(@Request() req) {
    return this.jobsService.findAll(req.user.companyId);
  }

  @Get(':id')
  @Roles('OWNER', 'ADMIN', 'MANAGER', 'WORKER')
  @ApiOperation({ summary: 'Get job site by ID' })
  findOne(@Request() req, @Param('id') id: string) {
    return this.jobsService.findOne(req.user.companyId, id);
  }

  @Patch(':id')
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Update job site' })
  update(@Request() req, @Param('id') id: string, @Body() updateJobDto: UpdateJobDto) {
    return this.jobsService.update(req.user.companyId, id, updateJobDto);
  }

  @Delete(':id')
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Deactivate job site' })
  remove(@Request() req, @Param('id') id: string) {
    return this.jobsService.remove(req.user.companyId, id);
  }
}