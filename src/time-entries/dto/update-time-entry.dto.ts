// ============================================
// ADD TO api.js - timeEntriesApi section
// ============================================

// Add this method to your existing timeEntriesApi object:

update: (id, data) => api.patch(`/time-entries/${id}`, data),


// ============================================
// BACKEND: time-entries.controller.ts
// Add this endpoint
// ============================================

@Patch(':id')
@UseGuards(JwtAuthGuard)
async updateEntry(
  @Param('id') id: string,
  @Request() req,
  @Body() updateData: {
    clockInTime?: string;
    clockOutTime?: string;
    breakMinutes?: number;
    jobId?: string;
    notes?: string;
  },
) {
  return this.timeEntriesService.updateEntry(id, req.user.companyId, req.user.id, updateData);
}


// ============================================
// BACKEND: time-entries.service.ts
// Add this method
// ============================================

async updateEntry(
  id: string,
  companyId: string,
  editedById: string,
  updateData: {
    clockInTime?: string;
    clockOutTime?: string;
    breakMinutes?: number;
    jobId?: string;
    notes?: string;
  },
) {
  // Find existing entry
  const entry = await this.prisma.timeEntry.findFirst({
    where: { id, companyId },
    include: { user: true, job: true },
  });

  if (!entry) {
    throw new NotFoundException('Time entry not found');
  }

  // Check if entry is locked
  if (entry.isLocked) {
    throw new BadRequestException('Cannot edit a locked time entry. Unlock the pay period first.');
  }

  // Check if pay period is exported (for amendment flag)
  const payPeriod = await this.prisma.payPeriod.findFirst({
    where: {
      companyId,
      startDate: { lte: new Date(entry.clockInTime) },
      endDate: { gte: new Date(entry.clockInTime) },
    },
  });

  const isAmendedAfterExport = payPeriod?.status === 'EXPORTED';

  // Store old values for audit
  const oldValues = {
    clockInTime: entry.clockInTime,
    clockOutTime: entry.clockOutTime,
    breakMinutes: entry.breakMinutes,
    jobId: entry.jobId,
    notes: entry.notes,
  };

  // Parse times
  const clockInTime = updateData.clockInTime ? new Date(updateData.clockInTime) : entry.clockInTime;
  const clockOutTime = updateData.clockOutTime ? new Date(updateData.clockOutTime) : entry.clockOutTime;

  // Validate clock out is after clock in
  if (clockOutTime && clockOutTime <= clockInTime) {
    throw new BadRequestException('Clock out time must be after clock in time');
  }

  // Validate not more than 24 hours
  if (clockOutTime) {
    const diffMs = clockOutTime.getTime() - clockInTime.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);
    if (diffHours > 24) {
      throw new BadRequestException('Time entry cannot exceed 24 hours');
    }
  }

  // Calculate duration
  let durationMinutes = null;
  if (clockOutTime) {
    const diffMs = clockOutTime.getTime() - clockInTime.getTime();
    durationMinutes = Math.round(diffMs / (1000 * 60)) - (updateData.breakMinutes ?? entry.breakMinutes ?? 0);
  }

  // Calculate overtime (simple daily overtime for now)
  let regularMinutes = 0;
  let overtimeMinutes = 0;
  let doubleTimeMinutes = 0;

  if (durationMinutes && durationMinutes > 0) {
    if (durationMinutes <= 480) { // 8 hours
      regularMinutes = durationMinutes;
    } else if (durationMinutes <= 720) { // 8-12 hours
      regularMinutes = 480;
      overtimeMinutes = durationMinutes - 480;
    } else { // 12+ hours
      regularMinutes = 480;
      overtimeMinutes = 240; // 4 hours OT
      doubleTimeMinutes = durationMinutes - 720;
    }
  }

  // Get pay rate for cost calculation
  const user = await this.prisma.user.findUnique({ where: { id: entry.userId } });
  const payRate = user?.payRate || 0;
  const laborCost = (regularMinutes / 60 * payRate) + 
                    (overtimeMinutes / 60 * payRate * 1.5) + 
                    (doubleTimeMinutes / 60 * payRate * 2);

  // Update entry
  const updatedEntry = await this.prisma.timeEntry.update({
    where: { id },
    data: {
      clockInTime,
      clockOutTime,
      breakMinutes: updateData.breakMinutes ?? entry.breakMinutes,
      jobId: updateData.jobId || null,
      notes: updateData.notes,
      durationMinutes,
      regularMinutes,
      overtimeMinutes,
      doubleTimeMinutes,
      laborCost,
      lastEditedById: editedById,
      amendedAfterExport: isAmendedAfterExport || entry.amendedAfterExport,
    },
    include: { user: true, job: true },
  });

  // Create audit log entry
  await this.prisma.auditLog.create({
    data: {
      companyId,
      userId: editedById,
      action: 'TIME_ENTRY_EDITED',
      targetType: 'TIME_ENTRY',
      targetId: id,
      details: {
        entryId: id,
        workerName: entry.user?.name,
        oldValues,
        newValues: {
          clockInTime: updatedEntry.clockInTime,
          clockOutTime: updatedEntry.clockOutTime,
          breakMinutes: updatedEntry.breakMinutes,
          jobId: updatedEntry.jobId,
          notes: updatedEntry.notes,
        },
        amendedAfterExport: isAmendedAfterExport,
      },
    },
  });

  return updatedEntry;
}
