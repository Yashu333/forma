-- CreateEnum
CREATE TYPE "Abcde" AS ENUM ('A', 'B', 'C', 'D', 'E');

-- AlterTable: ABCDE label, rank within a letter, and planned-for date
ALTER TABLE "Task" ADD COLUMN     "abcde" "Abcde",
ADD COLUMN     "abcdeRank" INTEGER,
ADD COLUMN     "plannedFor" TEXT;

-- CreateTable
CREATE TABLE "DailyPlan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "frogTaskId" TEXT,
    "plannedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "wentWell" TEXT,
    "improve" TEXT,
    "rating" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyPlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DailyPlan_userId_date_idx" ON "DailyPlan"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "DailyPlan_userId_date_key" ON "DailyPlan"("userId", "date");

-- AddForeignKey
ALTER TABLE "DailyPlan" ADD CONSTRAINT "DailyPlan_frogTaskId_fkey" FOREIGN KEY ("frogTaskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
