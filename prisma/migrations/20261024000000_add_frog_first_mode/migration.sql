-- AlterTable: optional "frog first" mode (dims the rest of /today until the frog is eaten)
ALTER TABLE "UserSettings" ADD COLUMN     "frogFirstMode" BOOLEAN NOT NULL DEFAULT false;
