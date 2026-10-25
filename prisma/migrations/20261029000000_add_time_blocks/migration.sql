-- AlterTable: time blocking (a start time and length for working on a task)
ALTER TABLE "Task" ADD COLUMN     "scheduledAt" TIMESTAMP(3),
ADD COLUMN     "blockMinutes" INTEGER;
