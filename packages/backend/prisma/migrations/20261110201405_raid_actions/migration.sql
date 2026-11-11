-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_RaidProtection" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "serverConfigId" INTEGER NOT NULL,
    "sid" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "settings" TEXT NOT NULL,
    "firstEnabledAt" DATETIME,
    "observeUntil" DATETIME,
    "acting" BOOLEAN NOT NULL DEFAULT false,
    "actingSince" DATETIME,
    "stoppedAt" DATETIME,
    "stoppedBy" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RaidProtection_serverConfigId_fkey" FOREIGN KEY ("serverConfigId") REFERENCES "TsServerConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_RaidProtection" ("enabled", "firstEnabledAt", "id", "observeUntil", "serverConfigId", "settings", "sid", "updatedAt") SELECT "enabled", "firstEnabledAt", "id", "observeUntil", "serverConfigId", "settings", "sid", "updatedAt" FROM "RaidProtection";
DROP TABLE "RaidProtection";
ALTER TABLE "new_RaidProtection" RENAME TO "RaidProtection";
CREATE UNIQUE INDEX "RaidProtection_serverConfigId_sid_key" ON "RaidProtection"("serverConfigId", "sid");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
