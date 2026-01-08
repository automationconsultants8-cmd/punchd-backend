import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CreateUserDto, UpdateUserDto, SetWorkerJobRateDto } from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@ApiTags('Users')
@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Create a new user' })
  create(@Request() req, @Body() createUserDto: CreateUserDto) {
    return this.usersService.create(req.user.companyId, createUserDto, req.user.userId);
  }

  @Get()
  @Roles('OWNER', 'ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Get all users in company' })
  findAll(@Request() req) {
    return this.usersService.findAll(req.user.companyId);
  }

  @Get(':id')
  @Roles('OWNER', 'ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Get user by ID' })
  findOne(@Request() req, @Param('id') id: string) {
    return this.usersService.findOne(req.user.companyId, id);
  }

  @Patch(':id')
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Update user' })
  update(@Request() req, @Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    return this.usersService.update(req.user.companyId, id, updateUserDto, req.user.userId);
  }

  @Delete(':id')
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Deactivate user' })
  remove(@Request() req, @Param('id') id: string) {
    return this.usersService.remove(req.user.companyId, id, req.user.userId);
  }

  @Patch(':id/approve')
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Approve a pending worker' })
  approve(@Request() req, @Param('id') id: string) {
    return this.usersService.approveWorker(req.user.companyId, id, req.user.userId);
  }

  @Patch(':id/decline')
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Decline a pending worker' })
  decline(@Request() req, @Param('id') id: string) {
    return this.usersService.declineWorker(req.user.companyId, id, req.user.userId);
  }

  // ============ PAY RATE ENDPOINTS ============
  @Get(':id/rates')
  @Roles('OWNER', 'ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Get all job-specific rates for a worker' })
  getWorkerRates(@Request() req, @Param('id') id: string) {
    return this.usersService.getWorkerJobRates(req.user.companyId, id);
  }

  @Post(':id/rates')
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Set job-specific rate for a worker' })
  setWorkerJobRate(
    @Request() req,
    @Param('id') id: string,
    @Body() dto: SetWorkerJobRateDto,
  ) {
    return this.usersService.setWorkerJobRate(req.user.companyId, id, dto, req.user.userId);
  }

  @Delete(':id/rates/:jobId')
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Remove job-specific rate for a worker' })
  removeWorkerJobRate(
    @Request() req,
    @Param('id') id: string,
    @Param('jobId') jobId: string,
  ) {
    return this.usersService.removeWorkerJobRate(req.user.companyId, id, jobId, req.user.userId);
  }
}
