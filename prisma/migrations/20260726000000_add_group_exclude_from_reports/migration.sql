-- AlterTable: let a project opt out of reporting entirely
ALTER TABLE "Group" ADD COLUMN     "excludeFromReports" BOOLEAN NOT NULL DEFAULT false;
