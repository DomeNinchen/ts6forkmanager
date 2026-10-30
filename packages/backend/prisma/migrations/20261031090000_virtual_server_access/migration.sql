-- CreateTable
CREATE TABLE "UserVirtualServerAccess" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "accessId" INTEGER NOT NULL,
    "sid" INTEGER NOT NULL,
    CONSTRAINT "UserVirtualServerAccess_accessId_fkey" FOREIGN KEY ("accessId") REFERENCES "UserServerAccess" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_UserServerAccess" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "serverConfigId" INTEGER NOT NULL,
    "allVirtualServers" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "UserServerAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UserServerAccess_serverConfigId_fkey" FOREIGN KEY ("serverConfigId") REFERENCES "TsServerConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_UserServerAccess" ("id", "serverConfigId", "userId") SELECT "id", "serverConfigId", "userId" FROM "UserServerAccess";
DROP TABLE "UserServerAccess";
ALTER TABLE "new_UserServerAccess" RENAME TO "UserServerAccess";
CREATE UNIQUE INDEX "UserServerAccess_userId_serverConfigId_key" ON "UserServerAccess"("userId", "serverConfigId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "UserVirtualServerAccess_accessId_sid_key" ON "UserVirtualServerAccess"("accessId", "sid");


-- Grants made before access per virtual server keep covering every virtual server of their
-- connection until the backend has read its server list and named them one by one (utils/vs-access.ts).
UPDATE "UserServerAccess" SET "allVirtualServers" = true;
