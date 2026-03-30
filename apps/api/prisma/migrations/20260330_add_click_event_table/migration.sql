-- CreateTable
CREATE TABLE "ClickEvent" (
    "id" TEXT NOT NULL,
    "accountId" VARCHAR(64),
    "clickId" VARCHAR(256) NOT NULL,
    "clickTime" VARCHAR(32),
    "adgroupId" VARCHAR(64),
    "callback" TEXT,
    "creativeId" VARCHAR(64),
    "adType" VARCHAR(16),
    "siteSet" VARCHAR(64),
    "requestId" VARCHAR(256),
    "deviceOs" VARCHAR(32),
    "muid" VARCHAR(128),
    "ip" VARCHAR(64),
    "userAgent" TEXT,
    "impressionId" VARCHAR(256),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClickEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClickEvent_clickId_idx" ON "ClickEvent"("clickId");
CREATE INDEX "ClickEvent_impressionId_idx" ON "ClickEvent"("impressionId");
CREATE INDEX "ClickEvent_requestId_idx" ON "ClickEvent"("requestId");
CREATE INDEX "ClickEvent_createdAt_idx" ON "ClickEvent"("createdAt");
