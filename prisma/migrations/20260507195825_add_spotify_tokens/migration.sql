-- AlterTable
ALTER TABLE "UserSettings" ADD COLUMN     "spotifyAccessToken" TEXT,
ADD COLUMN     "spotifyRefreshToken" TEXT,
ADD COLUMN     "spotifyTokenExpiresAt" TIMESTAMP(3);
