-- CreateTable
CREATE TABLE "UserSettings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "focusMins" INTEGER NOT NULL DEFAULT 25,
    "shortMins" INTEGER NOT NULL DEFAULT 5,
    "longMins" INTEGER NOT NULL DEFAULT 15,
    "sessionsBeforeLong" INTEGER NOT NULL DEFAULT 4,

    CONSTRAINT "UserSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserSettings_userId_key" ON "UserSettings"("userId");
