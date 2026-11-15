-- AlterTable (plain ADD COLUMN instead of the table redefine Prisma proposes)
ALTER TABLE "MusicBot" ADD COLUMN "voteSkipEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "MusicBot" ADD COLUMN "voteSkipPercent" INTEGER NOT NULL DEFAULT 50;
ALTER TABLE "MusicBot" ADD COLUMN "voteSkipMinVotes" INTEGER NOT NULL DEFAULT 1;

-- On for new bots only: bots that exist before this update keep behaving as before
UPDATE "MusicBot" SET "voteSkipEnabled" = false;
