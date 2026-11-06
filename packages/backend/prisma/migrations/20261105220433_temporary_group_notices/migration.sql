-- CreateTable
CREATE TABLE "TemporaryGroupNoticeSettings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "serverConfigId" INTEGER NOT NULL,
    "sid" INTEGER NOT NULL,
    "settings" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TemporaryGroupNoticeSettings_serverConfigId_fkey" FOREIGN KEY ("serverConfigId") REFERENCES "TsServerConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_TemporaryServerGroup" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "serverConfigId" INTEGER NOT NULL,
    "sid" INTEGER NOT NULL,
    "sgid" INTEGER NOT NULL,
    "cldbid" INTEGER NOT NULL,
    "clientUid" TEXT NOT NULL,
    "clientNickname" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "grantedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grantedByUserId" INTEGER,
    "grantedBy" TEXT NOT NULL,
    "via" TEXT NOT NULL DEFAULT 'main',
    "wasMember" BOOLEAN NOT NULL DEFAULT false,
    "state" TEXT NOT NULL DEFAULT 'active',
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" DATETIME,
    "endedAt" DATETIME,
    "deadlineSetAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "warnedBeforeMin" INTEGER,
    "pendingNotice" TEXT,
    "lastNotice" TEXT,
    CONSTRAINT "TemporaryServerGroup_serverConfigId_fkey" FOREIGN KEY ("serverConfigId") REFERENCES "TsServerConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_TemporaryServerGroup" ("attempts", "cldbid", "clientNickname", "clientUid", "endedAt", "error", "expiresAt", "grantedAt", "grantedBy", "grantedByUserId", "id", "nextAttemptAt", "serverConfigId", "sgid", "sid", "state", "via", "wasMember") SELECT "attempts", "cldbid", "clientNickname", "clientUid", "endedAt", "error", "expiresAt", "grantedAt", "grantedBy", "grantedByUserId", "id", "nextAttemptAt", "serverConfigId", "sgid", "sid", "state", "via", "wasMember" FROM "TemporaryServerGroup";
DROP TABLE "TemporaryServerGroup";
ALTER TABLE "new_TemporaryServerGroup" RENAME TO "TemporaryServerGroup";
CREATE INDEX "TemporaryServerGroup_nextAttemptAt_idx" ON "TemporaryServerGroup"("nextAttemptAt");
CREATE INDEX "TemporaryServerGroup_serverConfigId_sid_sgid_cldbid_idx" ON "TemporaryServerGroup"("serverConfigId", "sid", "sgid", "cldbid");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "TemporaryGroupNoticeSettings_serverConfigId_sid_key" ON "TemporaryGroupNoticeSettings"("serverConfigId", "sid");
