-- AlterTable
ALTER TABLE "ClickEvent" ADD COLUMN "vendor" VARCHAR(64);

-- CreateIndex
CREATE INDEX "ClickEvent_vendor_idx" ON "ClickEvent"("vendor");
