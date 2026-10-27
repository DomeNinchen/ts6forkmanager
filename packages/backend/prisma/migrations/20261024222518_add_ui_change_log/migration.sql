-- CreateTable
CREATE TABLE "UiChangeLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" INTEGER,
    "username" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "ip" TEXT,
    "method" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "routePattern" TEXT NOT NULL,
    "serverConfigId" INTEGER,
    "virtualServerId" INTEGER,
    "targetId" TEXT,
    "body" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "httpStatus" INTEGER,
    "errorMessage" TEXT,
    "durationMs" INTEGER,
    "loggedToTeamSpeak" BOOLEAN NOT NULL DEFAULT false
);

-- CreateIndex
CREATE INDEX "UiChangeLog_createdAt_idx" ON "UiChangeLog"("createdAt");

-- CreateIndex
CREATE INDEX "UiChangeLog_userId_createdAt_idx" ON "UiChangeLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "UiChangeLog_serverConfigId_createdAt_idx" ON "UiChangeLog"("serverConfigId", "createdAt");
