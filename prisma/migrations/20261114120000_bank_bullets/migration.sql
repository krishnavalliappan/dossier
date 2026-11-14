-- CreateTable
CREATE TABLE "BankBullet" (
    "id" TEXT NOT NULL,
    "baseId" TEXT NOT NULL,
    "variant" TEXT NOT NULL,
    "targetKind" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "tier" TEXT NOT NULL DEFAULT '',
    "sort" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankBullet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankClaimBlock" (
    "phrase" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankClaimBlock_pkey" PRIMARY KEY ("phrase")
);

-- CreateIndex
CREATE INDEX "BankBullet_targetId_idx" ON "BankBullet"("targetId");

