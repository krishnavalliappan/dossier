-- CreateTable
CREATE TABLE "ExtJobUrl" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "applicationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "ExtJobUrl_key_key" ON "ExtJobUrl"("key");

-- CreateIndex
CREATE INDEX "ExtJobUrl_applicationId_idx" ON "ExtJobUrl"("applicationId");

