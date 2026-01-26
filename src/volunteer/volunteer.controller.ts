// Save as: backend/src/volunteer/volunteer.controller.ts

import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, Request, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { VolunteerService } from './volunteer.service';

@ApiTags('Volunteer')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('volunteer')
export class VolunteerController {
  constructor(private volunteerService: VolunteerService) {}

  // ============================================
  // USER ENDPOINTS (for volunteer portal)
  // ============================================

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

  @Post('certificates/generate')
  async generateCertificate(@Request() req) {
    return this.volunteerService.generateCertificate(req.user.userId, req.user.companyId);
  }

  // ============================================
  // ADMIN ENDPOINTS (for admin dashboard)
  // ============================================

  @Get('admin/stats')
  async getApprovalStats(@Request() req) {
    return this.volunteerService.getApprovalStats(req.user.companyId);
  }

  @Get('admin/contractors/pending')
  async getContractorsPending(@Request() req) {
    return this.volunteerService.getAllContractorsPending(req.user.companyId);
  }

  @Get('admin/volunteers/pending')
  async getVolunteersPending(@Request() req) {
    return this.volunteerService.getAllVolunteersPending(req.user.companyId);
  }

  @Get('admin/sign-offs/pending')
  async getPendingSignOffs(@Request() req) {
    return this.volunteerService.getAllPendingSignOffs(req.user.companyId);
  }

  @Get('admin/sign-offs/:id')
  async getSignOffById(@Param('id') id: string, @Request() req) {
    return this.volunteerService.getSignOffById(id, req.user.companyId);
  }

  @Post('admin/entries/approve')
  async bulkApproveEntries(@Request() req, @Body() body: { entryIds: string[] }) {
    return this.volunteerService.bulkApproveEntries(body.entryIds, req.user.userId);
  }

  @Post('admin/entries/reject')
  async bulkRejectEntries(@Request() req, @Body() body: { entryIds: string[]; reason: string }) {
    return this.volunteerService.bulkRejectEntries(body.entryIds, req.user.userId, body.reason);
  }

  @Post('admin/sign-offs/:id/approve')
  async approveSignOff(@Param('id') id: string, @Request() req) {
    return this.volunteerService.approveSignOff(id, req.user.userId);
  }

  @Post('admin/sign-offs/:id/reject')
  async rejectSignOff(@Param('id') id: string, @Request() req, @Body() body: { reason: string }) {
    return this.volunteerService.rejectSignOff(id, req.user.userId, body.reason);
  }

  @Post('admin/certificates/generate/:userId')
  async generateCertificateForUser(@Param('userId') userId: string, @Request() req) {
    return this.volunteerService.generateCertificateForUser(userId, req.user.companyId);
  }

  @Get('admin/certificates')
  async getAllCertificates(@Request() req) {
    return this.volunteerService.getAllCertificates(req.user.companyId);
  }

  @Get('admin/certificate-threshold')
  async getCertificateThreshold(@Request() req) {
    return this.volunteerService.getCertificateThreshold(req.user.companyId);
  }

  @Patch('admin/certificate-threshold')
  async setCertificateThreshold(@Request() req, @Body() body: { hours: number }) {
    return this.volunteerService.setCertificateThreshold(req.user.companyId, body.hours);
  }
}
