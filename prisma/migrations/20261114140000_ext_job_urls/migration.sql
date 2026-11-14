-- CreateTable
CREATE TABLE "ExtJobUrl" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExtJobUrl_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExtJobUrl_key_key" ON "ExtJobUrl"("key");

-- CreateIndex
CREATE INDEX "ExtJobUrl_applicationId_idx" ON "ExtJobUrl"("applicationId");

