-- AlterTable
ALTER TABLE "BotFlow" ADD COLUMN "approvedAt" DATETIME;
ALTER TABLE "BotFlow" ADD COLUMN "approvedBy" TEXT;

-- Imported flows an admin already approved (flowData.imported.approved) stay approved; who and when is not known.
UPDATE "BotFlow" SET "approvedAt" = strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')
WHERE json_valid("flowData") AND json_extract("flowData", '$.imported.approved') = 1;
