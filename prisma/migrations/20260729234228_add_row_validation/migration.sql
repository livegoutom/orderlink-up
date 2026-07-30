-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ImportRow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "importJobId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "rawData" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "errors" TEXT,
    "shopifyOrderId" TEXT,
    "matchStatus" TEXT NOT NULL DEFAULT 'pending',
    "matchType" TEXT,
    "matchedVariantId" TEXT,
    "matchedVariantTitle" TEXT,
    "groupKey" TEXT,
    "validationStatus" TEXT NOT NULL DEFAULT 'pending',
    "validationErrors" TEXT,
    CONSTRAINT "ImportRow_importJobId_fkey" FOREIGN KEY ("importJobId") REFERENCES "ImportJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ImportRow" ("errors", "groupKey", "id", "importJobId", "matchStatus", "matchType", "matchedVariantId", "matchedVariantTitle", "rawData", "rowNumber", "shopifyOrderId", "status") SELECT "errors", "groupKey", "id", "importJobId", "matchStatus", "matchType", "matchedVariantId", "matchedVariantTitle", "rawData", "rowNumber", "shopifyOrderId", "status" FROM "ImportRow";
DROP TABLE "ImportRow";
ALTER TABLE "new_ImportRow" RENAME TO "ImportRow";
CREATE INDEX "ImportRow_importJobId_idx" ON "ImportRow"("importJobId");
CREATE INDEX "ImportRow_importJobId_matchStatus_idx" ON "ImportRow"("importJobId", "matchStatus");
CREATE INDEX "ImportRow_importJobId_groupKey_idx" ON "ImportRow"("importJobId", "groupKey");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
