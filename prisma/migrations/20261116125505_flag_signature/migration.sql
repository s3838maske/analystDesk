/*
  Warnings:

  - Added the required column `signature` to the `Flag` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Flag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "analysisId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "period" TEXT,
    "signature" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "affected" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "resolvedBy" TEXT,
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Flag_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "Analysis" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Flag" ("affected", "analysisId", "companyId", "createdAt", "id", "message", "period", "resolution", "resolvedAt", "resolvedBy", "severity", "status", "type") SELECT "affected", "analysisId", "companyId", "createdAt", "id", "message", "period", "resolution", "resolvedAt", "resolvedBy", "severity", "status", "type" FROM "Flag";
DROP TABLE "Flag";
ALTER TABLE "new_Flag" RENAME TO "Flag";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
