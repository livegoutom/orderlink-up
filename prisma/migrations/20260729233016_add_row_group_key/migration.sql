-- AlterTable
ALTER TABLE "ImportRow" ADD COLUMN "groupKey" TEXT;

-- CreateIndex
CREATE INDEX "ImportRow_importJobId_groupKey_idx" ON "ImportRow"("importJobId", "groupKey");
