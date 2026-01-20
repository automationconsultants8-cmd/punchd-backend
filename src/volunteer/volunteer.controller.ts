// Save as: backend/src/volunteer/volunteer.controller.ts

import { Controller, Get, Post, Delete, Body, Param, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { VolunteerService } from './volunteer.service';

@ApiTags('Volunteer')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('volunteer')
export class VolunteerController {
  constructor(private volunteerService: VolunteerService) {}

  @Get('dashboard')
  async getDashboard(@Request() req) {
    return this.volunteerService.getDashboard(req.user.userId, req.user.companyId);
  }

  @Get('goal')
  async getGoal(@Request() req) {
    return this.volunteerService.getGoal(req.user.userId);
  }

  @Post('goal')
  async setGoal(@Request() req, @Body() body: { targetHours: number; periodType?: string }) {
    return this.volunteerService.setGoal(
      req.user.userId,
      req.user.companyId,
      body.targetHours,
      body.periodType,
    );
  }

  @Delete('goal')
  async deleteGoal(@Request() req) {
    return this.volunteerService.deleteGoal(req.user.userId);
  }

  @Get('sign-off-requests')
  async getSignOffRequests(@Request() req) {
    return this.volunteerService.getSignOffRequests(req.user.userId);
  }

  @Post('sign-off-requests')
  async createSignOffRequest(
    @Request() req,
    @Body() body: {
      timeEntryIds: string[];
      supervisorEmail?: string;
      supervisorName?: string;
      notes?: string;
    },
  ) {
    return this.volunteerService.createSignOffRequest(
      req.user.userId,
      req.user.companyId,
      body.timeEntryIds,
      body.supervisorEmail,
      body.supervisorName,
      body.notes,
    );
  }

  @Get('pending-entries')
  async getPendingEntries(@Request() req) {
    return this.volunteerService.getPendingEntries(req.user.userId);
  }

  @Get('certificates')
  async getCertificates(@Request() req) {
    return this.volunteerService.getCertificates(req.user.userId);
  }

  @Post('sign-off-requests/:id/approve')
  async approveSignOff(@Param('id') id: string, @Request() req) {
    return this.volunteerService.approveSignOff(id, req.user.userId);
  }
}
