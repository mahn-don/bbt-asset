-- CreateTable
CREATE TABLE "ai_settings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "provider" TEXT NOT NULL DEFAULT 'HEURISTIC',
    "model" TEXT,
    "baseUrl" TEXT,
    "encryptedApiKey" TEXT,
    "credentialKeyId" TEXT,
    "credentialVersion" INTEGER NOT NULL DEFAULT 0,
    "credentialHint" TEXT,
    "connectionStatus" TEXT NOT NULL DEFAULT 'NOT_CONFIGURED',
    "lastTestedAt" DATETIME,
    "lastErrorCode" TEXT,
    "lastErrorSummary" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "scopeEvaluationEnabled" BOOLEAN NOT NULL DEFAULT true,
    "changeAnalysisEnabled" BOOLEAN NOT NULL DEFAULT true,
    "autoEvaluateNewScopes" BOOLEAN NOT NULL DEFAULT true,
    "autoReevaluateChangedScopes" BOOLEAN NOT NULL DEFAULT true,
    "heuristicFallbackEnabled" BOOLEAN NOT NULL DEFAULT true,
    "temperature" REAL,
    "maxTokens" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_scope_ai_evaluations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scopeId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "aiProvider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "evaluationSource" TEXT NOT NULL DEFAULT 'HEURISTIC',
    "language" TEXT NOT NULL DEFAULT 'en',
    "inputHash" TEXT NOT NULL,
    "businessValueScore" INTEGER,
    "attackSurfaceScore" INTEGER,
    "freshnessScore" INTEGER,
    "researchPotentialScore" INTEGER,
    "complexityScore" INTEGER,
    "policyFitScore" INTEGER,
    "duplicateRiskScore" INTEGER,
    "opportunityScore" INTEGER,
    "confidence" REAL,
    "summary" TEXT,
    "reasoningSummary" TEXT,
    "tags" TEXT,
    "suggestedResearchAreas" TEXT,
    "warnings" TEXT,
    "errorCode" TEXT,
    "errorSummary" TEXT,
    "latencyMs" INTEGER,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "evaluatedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "scope_ai_evaluations_scopeId_fkey" FOREIGN KEY ("scopeId") REFERENCES "scopes" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_scope_ai_evaluations" ("aiProvider", "attackSurfaceScore", "businessValueScore", "complexityScore", "confidence", "createdAt", "duplicateRiskScore", "errorCode", "errorSummary", "evaluatedAt", "freshnessScore", "id", "inputHash", "inputTokens", "latencyMs", "model", "opportunityScore", "outputTokens", "policyFitScore", "promptVersion", "reasoningSummary", "researchPotentialScore", "scopeId", "status", "suggestedResearchAreas", "summary", "tags", "updatedAt", "warnings") SELECT "aiProvider", "attackSurfaceScore", "businessValueScore", "complexityScore", "confidence", "createdAt", "duplicateRiskScore", "errorCode", "errorSummary", "evaluatedAt", "freshnessScore", "id", "inputHash", "inputTokens", "latencyMs", "model", "opportunityScore", "outputTokens", "policyFitScore", "promptVersion", "reasoningSummary", "researchPotentialScore", "scopeId", "status", "suggestedResearchAreas", "summary", "tags", "updatedAt", "warnings" FROM "scope_ai_evaluations";
DROP TABLE "scope_ai_evaluations";
ALTER TABLE "new_scope_ai_evaluations" RENAME TO "scope_ai_evaluations";
CREATE INDEX "scope_ai_evaluations_scopeId_createdAt_idx" ON "scope_ai_evaluations"("scopeId", "createdAt");
CREATE INDEX "scope_ai_evaluations_scopeId_status_idx" ON "scope_ai_evaluations"("scopeId", "status");
CREATE INDEX "scope_ai_evaluations_inputHash_idx" ON "scope_ai_evaluations"("inputHash");
CREATE INDEX "scope_ai_evaluations_opportunityScore_idx" ON "scope_ai_evaluations"("opportunityScore");
CREATE INDEX "scope_ai_evaluations_status_idx" ON "scope_ai_evaluations"("status");
CREATE TABLE "new_users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'RESEARCHER',
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "theme" TEXT NOT NULL DEFAULT 'system',
    "lastLoginAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_users" ("createdAt", "disabled", "email", "id", "lastLoginAt", "passwordHash", "role", "updatedAt") SELECT "createdAt", "disabled", "email", "id", "lastLoginAt", "passwordHash", "role", "updatedAt" FROM "users";
DROP TABLE "users";
ALTER TABLE "new_users" RENAME TO "users";
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
