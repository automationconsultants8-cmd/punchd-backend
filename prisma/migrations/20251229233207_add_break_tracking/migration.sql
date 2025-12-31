/*
  Warnings:

  - You are about to drop the column `adminOverrideReason` on the `time_entries` table. All the data in the column will be lost.
  - You are about to drop the column `clockInDeviceInfo` on the `time_entries` table. All the data in the column will be lost.
  - You are about to drop the column `clockInFaceMatchConfidence` on the `time_entries` table. All the data in the column will be lost.
  - You are about to drop the column `clockOutDeviceInfo` on the `time_entries` table. All the data in the column will be lost.
  - You are about to drop the column `clockOutFaceMatchConfidence` on the `time_entries` table. All the data in the column will be lost.
  - You are about to drop the column `entryType` on the `time_entries` table. All the data in the column will be lost.
  - You are about to drop the column `flagReasons` on the `time_entries` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "time_entries" DROP CONSTRAINT "time_entries_companyId_fkey";

-- DropForeignKey
ALTER TABLE "time_entries" DROP CONSTRAINT "time_entries_userId_fkey";

-- DropIndex
DROP INDEX "time_entries_companyId_createdAt_idx";

-- DropIndex
DROP INDEX "time_entries_companyId_jobId_idx";

-- DropIndex
DROP INDEX "time_entries_companyId_userId_idx";

-- DropIndex
DROP INDEX "time_entries_userId_clockInTime_idx";

-- AlterTable
ALTER TABLE "time_entries" DROP COLUMN "adminOverrideReason",
DROP COLUMN "clockInDeviceInfo",
DROP COLUMN "clockInFaceMatchConfidence",
DROP COLUMN "clockOutDeviceInfo",
DROP COLUMN "clockOutFaceMatchConfidence",
DROP COLUMN "entryType",
DROP COLUMN "flagReasons",
ADD COLUMN     "breakEndTime" TIMESTAMP(3),
ADD COLUMN     "breakMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "breakStartTime" TIMESTAMP(3),
ADD COLUMN     "flagReason" TEXT,
ADD COLUMN     "isOnBreak" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "notes" TEXT,
ALTER COLUMN "companyId" DROP NOT NULL,
ALTER COLUMN "clockInLocation" DROP NOT NULL,
ALTER COLUMN "clockInPhotoUrl" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
