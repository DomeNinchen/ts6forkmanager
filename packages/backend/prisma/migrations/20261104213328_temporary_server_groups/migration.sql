-- CreateTable
CREATE TABLE "TemporaryServerGroup" (
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
    CONSTRAINT "TemporaryServerGroup_serverConfigId_fkey" FOREIGN KEY ("serverConfigId") REFERENCES "TsServerConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "TemporaryServerGroup_nextAttemptAt_idx" ON "TemporaryServerGroup"("nextAttemptAt");

-- CreateIndex
CREATE INDEX "TemporaryServerGroup_serverConfigId_sid_sgid_cldbid_idx" ON "TemporaryServerGroup"("serverConfigId", "sid", "sgid", "cldbid");
