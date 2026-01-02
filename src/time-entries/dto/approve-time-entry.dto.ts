import { IsString, IsOptional, IsEnum, IsArray } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum ApprovalAction {
  APPROVE = 'APPROVE',
  REJECT = 'REJECT',
}

export class ApproveTimeEntryDto {
  @ApiPropertyOptional({ description: 'Reason for rejection (required when rejecting)' })
  @IsString()
  @IsOptional()
  rejectionReason?: string;
}

export class BulkApproveDto {
  @ApiProperty({ description: 'Array of time entry IDs to approve' })
  @IsArray()
  @IsString({ each: true })
  entryIds: string[];
}

export class BulkRejectDto {
  @ApiProperty({ description: 'Array of time entry IDs to reject' })
  @IsArray()
  @IsString({ each: true })
  entryIds: string[];

  @ApiProperty({ description: 'Reason for rejection' })
  @IsString()
  rejectionReason: string;
}
