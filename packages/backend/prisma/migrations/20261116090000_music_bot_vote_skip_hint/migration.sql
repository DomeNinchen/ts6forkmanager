-- AlterTable (plain ADD COLUMN instead of the table redefine Prisma proposes)
ALTER TABLE "MusicBot" ADD COLUMN "voteSkipHint" BOOLEAN NOT NULL DEFAULT false;
