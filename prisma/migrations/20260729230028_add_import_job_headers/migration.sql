/*
  Warnings:

  - Added the required column `headers` to the `ImportJob` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ImportJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "headers" TEXT NOT NULL,
    "totalRows" INTEGER NOT NULL,
    "columnMapping" TEXT,
    "orderMode" TEXT,
    "suppressNotifications" BOOLEAN NOT NULL DEFAULT true,
    "templateId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "startedAt" DATETIME,
    "completedAt" DATETIME
);
INSERT INTO "new_ImportJob" ("columnMapping", "completedAt", "createdAt", "fileName", "fileType", "id", "orderMode", "shop", "startedAt", "status", "suppressNotifications", "templateId", "totalRows", "updatedAt") SELECT "columnMapping", "completedAt", "createdAt", "fileName", "fileType", "id", "orderMode", "shop", "startedAt", "status", "suppressNotifications", "templateId", "totalRows", "updatedAt" FROM "ImportJob";
DROP TABLE "ImportJob";
ALTER TABLE "new_ImportJob" RENAME TO "ImportJob";
CREATE INDEX "ImportJob_shop_idx" ON "ImportJob"("shop");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
