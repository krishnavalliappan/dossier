-- CreateTable
CREATE TABLE "BankBullet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "baseId" TEXT NOT NULL,
    "variant" TEXT NOT NULL,
    "targetKind" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "tier" TEXT NOT NULL DEFAULT '',
    "sort" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "BankClaimBlock" (
    "phrase" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "BankBullet_targetId_idx" ON "BankBullet"("targetId");

