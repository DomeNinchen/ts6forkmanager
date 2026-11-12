-- CreateTable
CREATE TABLE "ImportedTemplate" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "templateId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "file" TEXT NOT NULL,
    "importedBy" TEXT,
    "importedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "ImportedTemplate_templateId_version_key" ON "ImportedTemplate"("templateId", "version");

