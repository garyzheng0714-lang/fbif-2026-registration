ALTER TABLE "Submission" ADD COLUMN "clickId" VARCHAR(128);
ALTER TABLE "Submission" ADD COLUMN "clickIdSourceKey" VARCHAR(32);

CREATE INDEX "Submission_clickId_idx" ON "Submission"("clickId");
CREATE INDEX "Submission_clickIdSourceKey_idx" ON "Submission"("clickIdSourceKey");
