-- CreateTable
CREATE TABLE "ProtectedServerGroup" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "serverConfigId" INTEGER NOT NULL,
    "sid" INTEGER NOT NULL,
    "sgid" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProtectedServerGroup_serverConfigId_fkey" FOREIGN KEY ("serverConfigId") REFERENCES "TsServerConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ProtectedServerGroup_serverConfigId_sid_sgid_key" ON "ProtectedServerGroup"("serverConfigId", "sid", "sgid");

