-- AlterTable
ALTER TABLE "ServerMetricRollup" ADD COLUMN "qualityN" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ServerMetricRollup" ADD COLUMN "lossSpeechAvg" REAL;
ALTER TABLE "ServerMetricRollup" ADD COLUMN "lossSpeechMax" REAL;
ALTER TABLE "ServerMetricRollup" ADD COLUMN "lossTotalAvg" REAL;
ALTER TABLE "ServerMetricRollup" ADD COLUMN "lossTotalMax" REAL;
ALTER TABLE "ServerMetricRollup" ADD COLUMN "clientPingAvg" REAL;
ALTER TABLE "ServerMetricRollup" ADD COLUMN "clientPingMax" REAL;
