-- AlterTable: add archive + completion tracking
ALTER TABLE "Task" ADD COLUMN     "archivedAt" TIMESTAMP(3);
ALTER TABLE "Task" ADD COLUMN     "completedAt" TIMESTAMP(3);

-- Backfill: tasks previously "deleted" were soft-hidden & recoverable, which is
-- what archive now means. Move them to archivedAt so they stay hidden from the
-- board but remain available for reporting; clear deletedAt (now = trash).
UPDATE "Task" SET "archivedAt" = "deletedAt" WHERE "deletedAt" IS NOT NULL;
UPDATE "Task" SET "deletedAt" = NULL WHERE "deletedAt" IS NOT NULL;

-- Backfill completedAt for tasks already sitting in a "done"/celebrate status,
-- so historical throughput isn't empty. Use updatedAt as best-available proxy.
UPDATE "Task" t
SET "completedAt" = t."updatedAt"
FROM "Status" s
WHERE t."statusId" = s."id"
  AND s."celebrate" = true
  AND t."completedAt" IS NULL
  AND t."deletedAt" IS NULL;
