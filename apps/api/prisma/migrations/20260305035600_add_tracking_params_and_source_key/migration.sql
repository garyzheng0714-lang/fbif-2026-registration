-- Add tracking attribution fields for URL query params collection.
ALTER TABLE "Submission"
ADD COLUMN "trackingParams" TEXT,
ADD COLUMN "trackingId" VARCHAR(512),
ADD COLUMN "trackingIdType" VARCHAR(128);
