-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('PENDING', 'PROCESSING', 'RETRYING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('industry', 'consumer');

-- CreateEnum
CREATE TYPE "IdType" AS ENUM ('cn_id', 'passport', 'other');

-- CreateTable
CREATE TABLE "Submission" (
    "id" TEXT NOT NULL,
    "clientRequestId" VARCHAR(64) NOT NULL,
    "traceId" VARCHAR(64) NOT NULL,
    "role" "Role" NOT NULL,
    "idType" "IdType" NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "title" VARCHAR(64) NOT NULL,
    "company" VARCHAR(128) NOT NULL,
    "phoneEnc" TEXT NOT NULL,
    "phoneHash" VARCHAR(64) NOT NULL,
    "idEnc" TEXT NOT NULL,
    "idHash" VARCHAR(64) NOT NULL,
    "businessType" VARCHAR(64),
    "department" VARCHAR(64),
    "proofUrls" JSONB,
    "syncStatus" "SyncStatus" NOT NULL DEFAULT 'PENDING',
    "syncError" TEXT,
    "syncAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3),
    "feishuRecordId" VARCHAR(64),
    "clientIp" VARCHAR(64),
    "userAgent" VARCHAR(256),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Submission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Submission_clientRequestId_key" ON "Submission"("clientRequestId");

-- CreateIndex
CREATE INDEX "Submission_phoneHash_idx" ON "Submission"("phoneHash");

-- CreateIndex
CREATE INDEX "Submission_idHash_idx" ON "Submission"("idHash");

-- CreateIndex
CREATE INDEX "Submission_syncStatus_createdAt_idx" ON "Submission"("syncStatus", "createdAt");

-- CreateIndex
CREATE INDEX "Submission_nextAttemptAt_idx" ON "Submission"("nextAttemptAt");
