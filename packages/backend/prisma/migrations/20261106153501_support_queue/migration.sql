-- CreateTable
CREATE TABLE "SupportQueue" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "serverConfigId" INTEGER NOT NULL,
    "sid" INTEGER NOT NULL,
    "channelId" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "settings" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SupportQueue_serverConfigId_fkey" FOREIGN KEY ("serverConfigId") REFERENCES "TsServerConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SupportCase" (
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
    CONSTRAINT "SupportCase_queueId_fkey" FOREIGN KEY ("queueId") REFERENCES "SupportQueue" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "SupportQueue_serverConfigId_sid_channelId_key" ON "SupportQueue"("serverConfigId", "sid", "channelId");

-- CreateIndex
CREATE INDEX "SupportCase_queueId_state_idx" ON "SupportCase"("queueId", "state");

-- CreateIndex
CREATE INDEX "SupportCase_endedAt_idx" ON "SupportCase"("endedAt");
