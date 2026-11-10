-- AlterTable
ALTER TABLE "ConnectionJournalEntry" ADD COLUMN "clientCreated" DATETIME;
ALTER TABLE "ConnectionJournalEntry" ADD COLUMN "servergroups" TEXT;

-- CreateTable
CREATE TABLE "RaidProtection" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "serverConfigId" INTEGER NOT NULL,
    "sid" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "settings" TEXT NOT NULL,
    "firstEnabledAt" DATETIME,
    "observeUntil" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RaidProtection_serverConfigId_fkey" FOREIGN KEY ("serverConfigId") REFERENCES "TsServerConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RaidIncident" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "serverConfigId" INTEGER NOT NULL,
    "sid" INTEGER NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'open',
    "mode" TEXT NOT NULL DEFAULT 'observe',
    "startedAt" DATETIME NOT NULL,
    "lastHitAt" DATETIME NOT NULL,
    "endedAt" DATETIME,
    "hits" TEXT NOT NULL,
    "clients" TEXT NOT NULL,
    "clientCount" INTEGER NOT NULL,
    "notice" TEXT,
    CONSTRAINT "RaidIncident_serverConfigId_fkey" FOREIGN KEY ("serverConfigId") REFERENCES "TsServerConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "RaidProtection_serverConfigId_sid_key" ON "RaidProtection"("serverConfigId", "sid");

-- CreateIndex
CREATE INDEX "RaidIncident_serverConfigId_sid_startedAt_idx" ON "RaidIncident"("serverConfigId", "sid", "startedAt");

-- CreateIndex
CREATE INDEX "RaidIncident_state_idx" ON "RaidIncident"("state");

-- CreateIndex
CREATE INDEX "ConnectionJournalEntry_serverConfigId_virtualServerId_uid_idx" ON "ConnectionJournalEntry"("serverConfigId", "virtualServerId", "uid");
