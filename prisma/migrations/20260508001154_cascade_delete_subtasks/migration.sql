-- DropForeignKey
ALTER TABLE "Task" DROP CONSTRAINT "Task_parentTaskId_fkey";

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_parentTaskId_fkey" FOREIGN KEY ("parentTaskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
