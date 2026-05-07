-- AlterTable
ALTER TABLE "UserSettings" ADD COLUMN     "autoStartBreaks" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "autoStartFocus" BOOLEAN NOT NULL DEFAULT false;
