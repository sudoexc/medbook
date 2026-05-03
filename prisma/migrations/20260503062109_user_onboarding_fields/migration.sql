-- AlterTable
ALTER TABLE "User" ADD COLUMN     "invitedById" TEXT,
ADD COLUMN     "lastLoginAt" TIMESTAMP(3),
ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
