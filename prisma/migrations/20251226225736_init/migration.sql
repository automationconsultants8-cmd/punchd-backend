-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('WORKER', 'ADMIN', 'OWNER');

-- CreateEnum
CREATE TYPE "EntryType" AS ENUM ('JOB_TIME', 'TRAVEL_TIME');

-- CreateEnum
CREATE TYPE "ViolationType" AS ENUM ('OUTSIDE_GEOFENCE', 'LOCATION_TELEPORT', 'FACE_MISMATCH', 'EARLY_CLOCK_IN', 'LATE_CLOCK_OUT', 'PHOTO_REUSE', 'SUSPICIOUS_PATTERN');

-- CreateEnum
CREATE TYPE "ViolationSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subscriptionTier" TEXT NOT NULL DEFAULT 'basic',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'WORKER',
    "referencePhotoUrl" TEXT,
    "rekognitionFaceId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "passwordHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "geofenceCenter" TEXT NOT NULL,
    "geofenceRadiusMeters" INTEGER NOT NULL DEFAULT 100,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "time_entries" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobId" TEXT,
    "entryType" "EntryType" NOT NULL DEFAULT 'JOB_TIME',
    "clockInTime" TIMESTAMP(3) NOT NULL,
    "clockInLocation" TEXT NOT NULL,
    "clockInPhotoUrl" TEXT NOT NULL,
    "clockInFaceMatchConfidence" DOUBLE PRECISION,
    "clockInDeviceInfo" JSONB,
    "clockOutTime" TIMESTAMP(3),
    "clockOutLocation" TEXT,
    "clockOutPhotoUrl" TEXT,
    "clockOutFaceMatchConfidence" DOUBLE PRECISION,
    "clockOutDeviceInfo" JSONB,
    "durationMinutes" INTEGER,
    "isFlagged" BOOLEAN NOT NULL DEFAULT false,
    "flagReasons" JSONB NOT NULL DEFAULT '[]',
    "adminOverrideReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "time_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "violations" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "timeEntryId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "violationType" "ViolationType" NOT NULL,
    "severity" "ViolationSeverity" NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "reviewed" BOOLEAN NOT NULL DEFAULT false,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "violations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "face_verification_logs" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "timeEntryId" TEXT,
    "submittedPhotoUrl" TEXT NOT NULL,
    "confidenceScore" DOUBLE PRECISION NOT NULL,
    "matched" BOOLEAN NOT NULL,
    "rekognitionResponse" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "face_verification_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_codes" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "users_companyId_email_idx" ON "users"("companyId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "users_companyId_phone_key" ON "users"("companyId", "phone");

-- CreateIndex
CREATE INDEX "jobs_companyId_isActive_idx" ON "jobs"("companyId", "isActive");

-- CreateIndex
CREATE INDEX "time_entries_companyId_createdAt_idx" ON "time_entries"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "time_entries_companyId_userId_idx" ON "time_entries"("companyId", "userId");

-- CreateIndex
CREATE INDEX "time_entries_companyId_jobId_idx" ON "time_entries"("companyId", "jobId");

-- CreateIndex
CREATE INDEX "time_entries_userId_clockInTime_idx" ON "time_entries"("userId", "clockInTime");

-- CreateIndex
CREATE INDEX "violations_companyId_reviewed_idx" ON "violations"("companyId", "reviewed");

-- CreateIndex
CREATE INDEX "violations_companyId_severity_idx" ON "violations"("companyId", "severity");

-- CreateIndex
CREATE INDEX "violations_userId_createdAt_idx" ON "violations"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "face_verification_logs_companyId_userId_idx" ON "face_verification_logs"("companyId", "userId");

-- CreateIndex
CREATE INDEX "face_verification_logs_timeEntryId_idx" ON "face_verification_logs"("timeEntryId");

-- CreateIndex
CREATE INDEX "otp_codes_phone_verified_expiresAt_idx" ON "otp_codes"("phone", "verified", "expiresAt");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "violations" ADD CONSTRAINT "violations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "violations" ADD CONSTRAINT "violations_timeEntryId_fkey" FOREIGN KEY ("timeEntryId") REFERENCES "time_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "violations" ADD CONSTRAINT "violations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "face_verification_logs" ADD CONSTRAINT "face_verification_logs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "face_verification_logs" ADD CONSTRAINT "face_verification_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "face_verification_logs" ADD CONSTRAINT "face_verification_logs_timeEntryId_fkey" FOREIGN KEY ("timeEntryId") REFERENCES "time_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
