-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'RESEARCHER',
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "lastLoginAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userAgent" TEXT,
    CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "providers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "provider_integrations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "providerId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "connectionStatus" TEXT NOT NULL DEFAULT 'NOT_CONFIGURED',
    "encryptedCredentials" TEXT,
    "credentialVersion" INTEGER NOT NULL DEFAULT 1,
    "credentialKeyId" TEXT,
    "credentialHint" TEXT,
    "lastTestedAt" DATETIME,
    "lastSuccessfulSyncAt" DATETIME,
    "lastAttemptedSyncAt" DATETIME,
    "lastErrorCode" TEXT,
    "lastErrorSummary" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "provider_integrations_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "programs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "providerId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "handleOrSlug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "visibility" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "policy" TEXT,
    "bountyMin" REAL,
    "bountyMax" REAL,
    "currency" TEXT,
    "safeHarbor" TEXT,
    "sourceCreatedAt" DATETIME,
    "sourceUpdatedAt" DATETIME,
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncedAt" DATETIME,
    "contentHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "programs_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "scopes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "programId" TEXT NOT NULL,
    "externalId" TEXT,
    "assetIdentifier" TEXT NOT NULL,
    "assetType" TEXT NOT NULL,
    "scopeStatus" TEXT NOT NULL DEFAULT 'IN_SCOPE',
    "eligibleForSubmission" BOOLEAN NOT NULL DEFAULT false,
    "eligibleForBounty" BOOLEAN NOT NULL DEFAULT false,
    "maxSeverity" TEXT,
    "instruction" TEXT,
    "providerMetadata" TEXT,
    "sourceCreatedAt" DATETIME,
    "sourceUpdatedAt" DATETIME,
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" DATETIME,
    "reviewedAt" DATETIME,
    "contentHash" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "scopes_programId_fkey" FOREIGN KEY ("programId") REFERENCES "programs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "scope_versions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scopeId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "canonicalSnapshot" TEXT NOT NULL,
    "providerSnapshot" TEXT,
    "contentHash" TEXT NOT NULL,
    "validFrom" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "scope_versions_scopeId_fkey" FOREIGN KEY ("scopeId") REFERENCES "scopes" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "change_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "providerId" TEXT NOT NULL,
    "programId" TEXT,
    "scopeId" TEXT,
    "changeType" TEXT NOT NULL,
    "fieldName" TEXT,
    "oldValue" TEXT,
    "newValue" TEXT,
    "detectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "importance" TEXT NOT NULL DEFAULT 'MEDIUM',
    "aiSummary" TEXT,
    "aiAnalysed" BOOLEAN NOT NULL DEFAULT false,
    "syncRunId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "change_events_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "change_events_programId_fkey" FOREIGN KEY ("programId") REFERENCES "programs" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "change_events_scopeId_fkey" FOREIGN KEY ("scopeId") REFERENCES "scopes" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "change_events_syncRunId_fkey" FOREIGN KEY ("syncRunId") REFERENCES "sync_runs" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "sync_runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "providerId" TEXT NOT NULL,
    "triggerType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "cursorBefore" TEXT,
    "cursorAfter" TEXT,
    "programsReceived" INTEGER NOT NULL DEFAULT 0,
    "programsCreated" INTEGER NOT NULL DEFAULT 0,
    "programsUpdated" INTEGER NOT NULL DEFAULT 0,
    "scopesReceived" INTEGER NOT NULL DEFAULT 0,
    "scopesCreated" INTEGER NOT NULL DEFAULT 0,
    "scopesUpdated" INTEGER NOT NULL DEFAULT 0,
    "scopesRemoved" INTEGER NOT NULL DEFAULT 0,
    "changesDetected" INTEGER NOT NULL DEFAULT 0,
    "aiJobsEnqueued" INTEGER NOT NULL DEFAULT 0,
    "rateLimitCount" INTEGER NOT NULL DEFAULT 0,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "errorSummary" TEXT,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sync_runs_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "scope_ai_evaluations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scopeId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "aiProvider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
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

-- CreateTable
CREATE TABLE "jobs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "priority" INTEGER NOT NULL DEFAULT 100,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "availableAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "lockedBy" TEXT,
    "lockedAt" DATETIME,
    "errorCode" TEXT,
    "errorSummary" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "research_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scopeId" TEXT NOT NULL,
    "userId" TEXT,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "notes" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "durationMinutes" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "research_sessions_scopeId_fkey" FOREIGN KEY ("scopeId") REFERENCES "scopes" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "research_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "findings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scopeId" TEXT NOT NULL,
    "researchSessionId" TEXT,
    "title" TEXT NOT NULL,
    "severity" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "submittedAt" DATETIME,
    "resolvedAt" DATETIME,
    "payoutAmount" REAL,
    "payoutCurrency" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "findings_scopeId_fkey" FOREIGN KEY ("scopeId") REFERENCES "scopes" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "findings_researchSessionId_fkey" FOREIGN KEY ("researchSessionId") REFERENCES "research_sessions" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "providers_slug_key" ON "providers"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "provider_integrations_providerId_key" ON "provider_integrations"("providerId");

-- CreateIndex
CREATE INDEX "programs_providerId_handleOrSlug_idx" ON "programs"("providerId", "handleOrSlug");

-- CreateIndex
CREATE INDEX "programs_status_idx" ON "programs"("status");

-- CreateIndex
CREATE INDEX "programs_sourceUpdatedAt_idx" ON "programs"("sourceUpdatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "programs_providerId_externalId_key" ON "programs"("providerId", "externalId");

-- CreateIndex
CREATE INDEX "scopes_programId_externalId_idx" ON "scopes"("programId", "externalId");

-- CreateIndex
CREATE INDEX "scopes_scopeStatus_idx" ON "scopes"("scopeStatus");

-- CreateIndex
CREATE INDEX "scopes_assetType_idx" ON "scopes"("assetType");

-- CreateIndex
CREATE INDEX "scopes_eligibleForBounty_idx" ON "scopes"("eligibleForBounty");

-- CreateIndex
CREATE INDEX "scopes_maxSeverity_idx" ON "scopes"("maxSeverity");

-- CreateIndex
CREATE INDEX "scopes_sourceUpdatedAt_idx" ON "scopes"("sourceUpdatedAt");

-- CreateIndex
CREATE INDEX "scopes_lastSeenAt_idx" ON "scopes"("lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "scopes_programId_assetIdentifier_assetType_key" ON "scopes"("programId", "assetIdentifier", "assetType");

-- CreateIndex
CREATE INDEX "scope_versions_scopeId_validFrom_idx" ON "scope_versions"("scopeId", "validFrom");

-- CreateIndex
CREATE UNIQUE INDEX "scope_versions_scopeId_version_key" ON "scope_versions"("scopeId", "version");

-- CreateIndex
CREATE INDEX "change_events_scopeId_detectedAt_idx" ON "change_events"("scopeId", "detectedAt");

-- CreateIndex
CREATE INDEX "change_events_programId_detectedAt_idx" ON "change_events"("programId", "detectedAt");

-- CreateIndex
CREATE INDEX "change_events_changeType_detectedAt_idx" ON "change_events"("changeType", "detectedAt");

-- CreateIndex
CREATE INDEX "change_events_providerId_detectedAt_idx" ON "change_events"("providerId", "detectedAt");

-- CreateIndex
CREATE INDEX "change_events_importance_detectedAt_idx" ON "change_events"("importance", "detectedAt");

-- CreateIndex
CREATE INDEX "sync_runs_providerId_startedAt_idx" ON "sync_runs"("providerId", "startedAt");

-- CreateIndex
CREATE INDEX "sync_runs_status_idx" ON "sync_runs"("status");

-- CreateIndex
CREATE INDEX "scope_ai_evaluations_scopeId_createdAt_idx" ON "scope_ai_evaluations"("scopeId", "createdAt");

-- CreateIndex
CREATE INDEX "scope_ai_evaluations_scopeId_status_idx" ON "scope_ai_evaluations"("scopeId", "status");

-- CreateIndex
CREATE INDEX "scope_ai_evaluations_inputHash_idx" ON "scope_ai_evaluations"("inputHash");

-- CreateIndex
CREATE INDEX "scope_ai_evaluations_opportunityScore_idx" ON "scope_ai_evaluations"("opportunityScore");

-- CreateIndex
CREATE INDEX "scope_ai_evaluations_status_idx" ON "scope_ai_evaluations"("status");

-- CreateIndex
CREATE UNIQUE INDEX "jobs_dedupeKey_key" ON "jobs"("dedupeKey");

-- CreateIndex
CREATE INDEX "jobs_status_availableAt_priority_idx" ON "jobs"("status", "availableAt", "priority");

-- CreateIndex
CREATE INDEX "jobs_type_status_idx" ON "jobs"("type", "status");

-- CreateIndex
CREATE INDEX "research_sessions_scopeId_startedAt_idx" ON "research_sessions"("scopeId", "startedAt");

-- CreateIndex
CREATE INDEX "research_sessions_status_idx" ON "research_sessions"("status");

-- CreateIndex
CREATE INDEX "findings_scopeId_createdAt_idx" ON "findings"("scopeId", "createdAt");

-- CreateIndex
CREATE INDEX "findings_status_idx" ON "findings"("status");
