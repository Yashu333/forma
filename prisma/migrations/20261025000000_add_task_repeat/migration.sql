-- AlterTable: recurring tasks (repeat rule, series id, link to the next instance)
ALTER TABLE "Task" ADD COLUMN     "repeat" JSONB,
ADD COLUMN     "seriesId" TEXT,
ADD COLUMN     "nextInstanceId" TEXT;

-- CreateIndex
CREATE INDEX "Task_seriesId_idx" ON "Task"("seriesId");
