-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SupportCase" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "queueId" INTEGER NOT NULL,
    "clientUid" TEXT NOT NULL,
    "cldbid" INTEGER NOT NULL,
    "nickname" TEXT NOT NULL,
    "arrivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "arrivalUnknown" BOOLEAN NOT NULL DEFAULT false,
    "state" TEXT NOT NULL DEFAULT 'waiting',
    "absentSince" DATETIME,
    "takenAt" DATETIME,
    "takenBy" TEXT,
    "takenVia" TEXT,
    "actedBy" TEXT,
    "roomCid" INTEGER,
    "endedAt" DATETIME,
    "endReason" TEXT,
    "notices" TEXT,
    "vip" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "SupportCase_queueId_fkey" FOREIGN KEY ("queueId") REFERENCES "SupportQueue" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_SupportCase" ("absentSince", "actedBy", "arrivalUnknown", "arrivedAt", "cldbid", "clientUid", "endReason", "endedAt", "id", "nickname", "notices", "queueId", "roomCid", "state", "takenAt", "takenBy", "takenVia") SELECT "absentSince", "actedBy", "arrivalUnknown", "arrivedAt", "cldbid", "clientUid", "endReason", "endedAt", "id", "nickname", "notices", "queueId", "roomCid", "state", "takenAt", "takenBy", "takenVia" FROM "SupportCase";
DROP TABLE "SupportCase";
ALTER TABLE "new_SupportCase" RENAME TO "SupportCase";
CREATE INDEX "SupportCase_queueId_state_idx" ON "SupportCase"("queueId", "state");
CREATE INDEX "SupportCase_endedAt_idx" ON "SupportCase"("endedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
