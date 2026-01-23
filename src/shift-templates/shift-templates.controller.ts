import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, Request } from '@nestjs/common';
import { ShiftTemplatesService } from './shift-templates.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SettingsGuard, RequireSetting } from '../common/settings.guard';

@Controller('shift-templates')
@UseGuards(JwtAuthGuard, SettingsGuard)
@RequireSetting('shiftScheduling')
export class ShiftTemplatesController {
  constructor(private service: ShiftTemplatesService) {}

  @Get()
  findAll(@Request() req) {
    return this.service.findAll(req.user.companyId);
  }

  @Get('today')
  getTodayShifts(@Request() req) {
    return this.service.getTodayShifts(req.user.companyId);
  }

  @Get('my')
  getMyShifts(@Request() req) {
    return this.service.getMyShifts(req.user.id);
  }

  @Get('my/pending')
  getPendingAssignments(@Request() req) {
    return this.service.getPendingAssignments(req.user.id);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Request() req) {
    return this.service.findOne(id, req.user.companyId);
  }

  @Post()
  create(@Request() req, @Body() body: {
    name: string;
    daysOfWeek: number[];
    startTime: string;
    endTime: string;
    jobId?: string;
    notes?: string;
  }) {
    return this.service.create(req.user.companyId, body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Request() req, @Body() body: {
    name?: string;
    daysOfWeek?: number[];
    startTime?: string;
    endTime?: string;
    jobId?: string;
    notes?: string;
  }) {
    return this.service.update(id, req.user.companyId, body);
  }

  @Delete(':id')
  delete(@Param('id') id: string, @Request() req) {
    return this.service.delete(id, req.user.companyId);
  }

  @Post(':id/assign')
  assignWorkers(@Param('id') id: string, @Request() req, @Body() body: {
    userIds: string[];
    startDate: string;
    endDate: string;
  }) {
    return this.service.assignWorkers(id, req.user.companyId, body);
  }

  @Get(':id/workers')
  getAssignedWorkers(@Param('id') id: string, @Request() req) {
    return this.service.getAssignedWorkers(id, req.user.companyId);
  }

  @Delete(':id/workers/:userId')
  removeWorker(@Param('id') id: string, @Param('userId') userId: string, @Request() req) {
    return this.service.removeWorker(id, userId, req.user.companyId);
  }

  @Post('one-off')
  createOneOff(@Request() req, @Body() body: {
    date: string;
    startTime: string;
    endTime: string;
    jobId?: string;
    userIds: string[];
    notes?: string;
  }) {
    return this.service.createOneOff(req.user.companyId, body);
  }

  @Post('respond/:batchId')
  respond(@Param('batchId') batchId: string, @Request() req, @Body() body: {
    accept: boolean;
    declineReason?: string;
  }) {
    return this.service.respondToShift(req.user.id, batchId, body.accept, body.declineReason);
  }
}
