-- CreateTable
CREATE TABLE "User" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT,
    "email" TEXT,
    "externalId" TEXT,
    "authProvider" TEXT NOT NULL DEFAULT 'local',
    "displayName" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'viewer',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "lastLoginAt" DATETIME,
    "language" TEXT,
    "totpSecret" TEXT,
    "totpEnabled" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "UserSetting" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserSetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "token" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "family" TEXT,
    "replacedBy" TEXT,
    CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RecoveryCode" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RecoveryCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TrustedDevice" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TrustedDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserServerAccess" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "serverConfigId" INTEGER NOT NULL,
    CONSTRAINT "UserServerAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UserServerAccess_serverConfigId_fkey" FOREIGN KEY ("serverConfigId") REFERENCES "TsServerConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TsServerConfig" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "webqueryPort" INTEGER NOT NULL DEFAULT 10080,
    "apiKey" TEXT,
    "useHttps" BOOLEAN NOT NULL DEFAULT false,
    "sshPort" INTEGER NOT NULL DEFAULT 10022,
    "sshUsername" TEXT,
    "sshPassword" TEXT,
    "pingHost" TEXT,
    "queryNickname" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "recordUserHistory" BOOLEAN NOT NULL DEFAULT true,
    "recordConnectionJournal" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "botQueryName" TEXT,
    "botApiKey" TEXT,
    "botCldbid" INTEGER
);

-- CreateTable
CREATE TABLE "BotFlow" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "flowData" TEXT NOT NULL DEFAULT '{"nodes":[],"edges":[]}',
    "serverConfigId" INTEGER NOT NULL,
    "virtualServerId" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BotFlow_serverConfigId_fkey" FOREIGN KEY ("serverConfigId") REFERENCES "TsServerConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BotVariable" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "flowId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "value" TEXT NOT NULL DEFAULT '',
    "scope" TEXT NOT NULL DEFAULT 'flow',
    CONSTRAINT "BotVariable_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "BotFlow" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BotExecution" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "flowId" INTEGER NOT NULL,
    "triggeredBy" TEXT NOT NULL,
    "triggerData" TEXT,
    "status" TEXT NOT NULL DEFAULT 'running',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    "error" TEXT,
    CONSTRAINT "BotExecution_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "BotFlow" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BotExecutionLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "executionId" INTEGER,
    "serverConfigId" INTEGER NOT NULL,
    "flowId" INTEGER,
    "nodeId" TEXT,
    "nodeName" TEXT,
    "level" TEXT NOT NULL DEFAULT 'info',
    "message" TEXT NOT NULL,
    "data" TEXT,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BotExecutionLog_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "BotExecution" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BotExecutionLog_serverConfigId_fkey" FOREIGN KEY ("serverConfigId") REFERENCES "TsServerConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MusicBot" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "serverConfigId" INTEGER NOT NULL,
    "nickname" TEXT NOT NULL DEFAULT 'MusicBot',
    "serverPassword" TEXT,
    "defaultChannel" TEXT,
    "channelPassword" TEXT,
    "voicePort" INTEGER NOT NULL DEFAULT 9987,
    "volume" INTEGER NOT NULL DEFAULT 50,
    "identityData" TEXT,
    "autoStart" BOOLEAN NOT NULL DEFAULT false,
    "streamPreset" TEXT NOT NULL DEFAULT '720p',
    "sidecarPort" INTEGER NOT NULL DEFAULT 9800,
    "descriptionTemplate" TEXT,
    "avatarData" BLOB,
    "avatarMimeType" TEXT,
    "autoplayMode" TEXT NOT NULL DEFAULT 'none',
    "autoplaySongId" INTEGER,
    "autoplayRadioStationId" INTEGER,
    "idlePauseMinutes" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MusicBot_serverConfigId_fkey" FOREIGN KEY ("serverConfigId") REFERENCES "TsServerConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MusicBot_autoplaySongId_fkey" FOREIGN KEY ("autoplaySongId") REFERENCES "Song" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MusicBot_autoplayRadioStationId_fkey" FOREIGN KEY ("autoplayRadioStationId") REFERENCES "RadioStation" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Song" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "title" TEXT NOT NULL,
    "artist" TEXT,
    "duration" REAL,
    "filePath" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'local',
    "sourceUrl" TEXT,
    "fileSize" INTEGER,
    "mediaType" TEXT NOT NULL DEFAULT 'audio',
    "serverConfigId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Song_serverConfigId_fkey" FOREIGN KEY ("serverConfigId") REFERENCES "TsServerConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Playlist" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "musicBotId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Playlist_musicBotId_fkey" FOREIGN KEY ("musicBotId") REFERENCES "MusicBot" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PlaylistSong" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "playlistId" INTEGER NOT NULL,
    "songId" INTEGER NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "PlaylistSong_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "Playlist" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlaylistSong_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RadioStation" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "genre" TEXT,
    "imageUrl" TEXT,
    "serverConfigId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RadioStation_serverConfigId_fkey" FOREIGN KEY ("serverConfigId") REFERENCES "TsServerConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Widget" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "serverConfigId" INTEGER NOT NULL,
    "virtualServerId" INTEGER NOT NULL DEFAULT 1,
    "theme" TEXT NOT NULL DEFAULT 'dark',
    "showChannelTree" BOOLEAN NOT NULL DEFAULT true,
    "showClients" BOOLEAN NOT NULL DEFAULT true,
    "hideEmptyChannels" BOOLEAN NOT NULL DEFAULT false,
    "maxChannelDepth" INTEGER NOT NULL DEFAULT 5,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Widget_serverConfigId_fkey" FOREIGN KEY ("serverConfigId") REFERENCES "TsServerConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MusicRequest" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "serverConfigId" INTEGER NOT NULL,
    "requestedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MusicRequest_serverConfigId_fkey" FOREIGN KEY ("serverConfigId") REFERENCES "TsServerConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StreamSession" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "musicBotId" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "preset" TEXT NOT NULL DEFAULT '720p',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    "peakViewers" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "BotCommandPermission" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "serverConfigId" INTEGER NOT NULL,
    "command" TEXT NOT NULL,
    "allowedGroupIds" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BotCommandPermission_serverConfigId_fkey" FOREIGN KEY ("serverConfigId") REFERENCES "TsServerConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BotCommandAdminGroup" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "serverConfigId" INTEGER NOT NULL,
    "groupId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BotCommandAdminGroup_serverConfigId_fkey" FOREIGN KEY ("serverConfigId") REFERENCES "TsServerConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QueryConsoleLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" INTEGER,
    "username" TEXT NOT NULL,
    "serverConfigId" INTEGER NOT NULL,
    "serverName" TEXT NOT NULL,
    "virtualServerId" INTEGER NOT NULL,
    "command" TEXT NOT NULL,
    "commandName" TEXT NOT NULL,
    "danger" BOOLEAN NOT NULL DEFAULT false,
    "mutating" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "errorCode" INTEGER,
    "errorMessage" TEXT,
    "durationMs" INTEGER,
    "loggedToTeamSpeak" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "ServerMetricSample" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "serverConfigId" INTEGER NOT NULL,
    "virtualServerId" INTEGER NOT NULL,
    "measuredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "incoming" INTEGER NOT NULL,
    "outgoing" INTEGER NOT NULL,
    "ping" INTEGER NOT NULL,
    CONSTRAINT "ServerMetricSample_serverConfigId_fkey" FOREIGN KEY ("serverConfigId") REFERENCES "TsServerConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ServerUserSample" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "serverConfigId" INTEGER NOT NULL,
    "virtualServerId" INTEGER NOT NULL,
    "measuredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "state" TEXT NOT NULL,
    "users" INTEGER,
    "maxClients" INTEGER,
    "intervalSec" INTEGER NOT NULL,
    CONSTRAINT "ServerUserSample_serverConfigId_fkey" FOREIGN KEY ("serverConfigId") REFERENCES "TsServerConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ServerMetricRollup" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "serverConfigId" INTEGER NOT NULL,
    "virtualServerId" INTEGER NOT NULL,
    "measuredAt" DATETIME NOT NULL,
    "intervalSec" INTEGER NOT NULL,
    "bytesIn" BIGINT,
    "bytesOut" BIGINT,
    "spanSec" INTEGER,
    "peakIn" INTEGER,
    "peakOut" INTEGER,
    "pingOk" INTEGER NOT NULL,
    "pingFailed" INTEGER NOT NULL,
    "pingAvg" INTEGER,
    "pingMin" INTEGER,
    "pingMax" INTEGER,
    CONSTRAINT "ServerMetricRollup_serverConfigId_fkey" FOREIGN KEY ("serverConfigId") REFERENCES "TsServerConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ConnectionJournalEntry" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "reason" TEXT,
    "username" TEXT,
    "userId" INTEGER,
    "ip" TEXT NOT NULL,
    "userAgent" TEXT,
    "country" TEXT,
    "region" TEXT,
    "city" TEXT,
    "serverConfigId" INTEGER,
    "virtualServerId" INTEGER,
    "serverName" TEXT,
    "uid" TEXT,
    "cldbid" INTEGER,
    "clid" INTEGER,
    "clientVersion" TEXT,
    "clientPlatform" TEXT,
    "leftAt" DATETIME,
    "leaveReason" TEXT
);

-- CreateTable
CREATE TABLE "IpBan" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "ip" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME,
    "createdBy" TEXT NOT NULL,
    "blockedCount" INTEGER NOT NULL DEFAULT 0,
    "lastBlockedAt" DATETIME
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_externalId_key" ON "User"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "UserSetting_userId_key_key" ON "UserSetting"("userId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_token_key" ON "RefreshToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "TrustedDevice_token_key" ON "TrustedDevice"("token");

-- CreateIndex
CREATE UNIQUE INDEX "UserServerAccess_userId_serverConfigId_key" ON "UserServerAccess"("userId", "serverConfigId");

-- CreateIndex
CREATE UNIQUE INDEX "BotVariable_flowId_name_scope_key" ON "BotVariable"("flowId", "name", "scope");

-- CreateIndex
CREATE INDEX "BotExecutionLog_executionId_idx" ON "BotExecutionLog"("executionId");

-- CreateIndex
CREATE INDEX "BotExecutionLog_flowId_idx" ON "BotExecutionLog"("flowId");

-- CreateIndex
CREATE INDEX "BotExecutionLog_timestamp_idx" ON "BotExecutionLog"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "PlaylistSong_playlistId_songId_key" ON "PlaylistSong"("playlistId", "songId");

-- CreateIndex
CREATE UNIQUE INDEX "Widget_token_key" ON "Widget"("token");

-- CreateIndex
CREATE UNIQUE INDEX "MusicRequest_serverConfigId_url_key" ON "MusicRequest"("serverConfigId", "url");

-- CreateIndex
CREATE UNIQUE INDEX "BotCommandPermission_serverConfigId_command_key" ON "BotCommandPermission"("serverConfigId", "command");

-- CreateIndex
CREATE UNIQUE INDEX "BotCommandAdminGroup_serverConfigId_groupId_key" ON "BotCommandAdminGroup"("serverConfigId", "groupId");

-- CreateIndex
CREATE INDEX "QueryConsoleLog_createdAt_idx" ON "QueryConsoleLog"("createdAt");

-- CreateIndex
CREATE INDEX "QueryConsoleLog_serverConfigId_createdAt_idx" ON "QueryConsoleLog"("serverConfigId", "createdAt");

-- CreateIndex
CREATE INDEX "ServerMetricSample_serverConfigId_virtualServerId_measuredAt_idx" ON "ServerMetricSample"("serverConfigId", "virtualServerId", "measuredAt");

-- CreateIndex
CREATE INDEX "ServerUserSample_serverConfigId_virtualServerId_measuredAt_idx" ON "ServerUserSample"("serverConfigId", "virtualServerId", "measuredAt");

-- CreateIndex
CREATE INDEX "ServerMetricRollup_serverConfigId_virtualServerId_measuredAt_idx" ON "ServerMetricRollup"("serverConfigId", "virtualServerId", "measuredAt");

-- CreateIndex
CREATE INDEX "ConnectionJournalEntry_at_idx" ON "ConnectionJournalEntry"("at");

-- CreateIndex
CREATE INDEX "ConnectionJournalEntry_ip_at_idx" ON "ConnectionJournalEntry"("ip", "at");

-- CreateIndex
CREATE INDEX "ConnectionJournalEntry_source_at_idx" ON "ConnectionJournalEntry"("source", "at");

-- CreateIndex
CREATE INDEX "ConnectionJournalEntry_source_serverConfigId_virtualServerId_leftAt_idx" ON "ConnectionJournalEntry"("source", "serverConfigId", "virtualServerId", "leftAt");

-- CreateIndex
CREATE INDEX "ConnectionJournalEntry_country_idx" ON "ConnectionJournalEntry"("country");

-- CreateIndex
CREATE UNIQUE INDEX "IpBan_ip_key" ON "IpBan"("ip");

-- CreateIndex
CREATE INDEX "IpBan_expiresAt_idx" ON "IpBan"("expiresAt");
