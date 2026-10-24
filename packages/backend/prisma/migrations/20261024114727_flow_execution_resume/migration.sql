-- AlterTable
ALTER TABLE "BotExecution" ADD COLUMN "createdChannels" TEXT;
ALTER TABLE "BotExecution" ADD COLUMN "resumeAt" DATETIME;
ALTER TABLE "BotExecution" ADD COLUMN "resumeNodeId" TEXT;
ALTER TABLE "BotExecution" ADD COLUMN "state" TEXT;
