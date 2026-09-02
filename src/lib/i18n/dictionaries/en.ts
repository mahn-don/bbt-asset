/**
 * English dictionary — the source of truth.
 *
 * Every other locale is typed as `Messages`, so adding a key here and
 * forgetting it elsewhere fails the typecheck.
 *
 * Technical identifiers are deliberately absent: provider names (HackerOne,
 * Bugcrowd…), asset types (API, URL, CIDR, iOS…), protocol names and model ids
 * are rendered verbatim in every locale.
 */

export const en = {
  // --- Brand / chrome -----------------------------------------------------
  "app.name": "Asset Intelligence",
  "app.brandShort": "BBI",
  "app.tagline": "Bug bounty scope inventory and research prioritisation.",
  "app.footerNote":
    "Scores rank research opportunity, not vulnerability severity. Only assets confirmed in scope by provider data are authorized for research.",

  // --- Navigation ---------------------------------------------------------
  "nav.primary": "Primary",
  "nav.dashboard": "Dashboard",
  "nav.assets": "Assets",
  "nav.programs": "Programs",
  "nav.changes": "Changes",
  "nav.settings": "Settings",
  "nav.signOut": "Sign out",
  "nav.signingOut": "Signing out…",
  "nav.theme": "Theme",
  "nav.language": "Language",
  "nav.openSettings": "Open settings",

  // --- Auth ---------------------------------------------------------------
  "auth.email": "Email",
  "auth.password": "Password",
  "auth.signIn": "Sign in",
  "auth.signingIn": "Signing in…",
  "auth.failed": "Sign in failed.",
  "auth.networkError": "Network error — could not reach the server.",
  "auth.noAccountTitle": "No account exists yet. Create one with:",

  // --- Common -------------------------------------------------------------
  "common.save": "Save",
  "common.saving": "Saving…",
  "common.cancel": "Cancel",
  "common.reset": "Reset",
  "common.apply": "Apply filters",
  "common.search": "Search",
  "common.all": "All",
  "common.any": "Any",
  "common.yes": "Yes",
  "common.no": "No",
  "common.none": "None",
  "common.never": "Never",
  "common.unknown": "Unknown",
  "common.notPublished": "Not published",
  "common.notSpecified": "Not specified",
  "common.enabled": "Enabled",
  "common.disabled": "Disabled",
  "common.loading": "Loading…",
  "common.perPage": "Per page",
  "common.sort": "Sort",
  "common.previous": "Previous",
  "common.next": "Next",
  "common.pagination": "Pagination",
  "common.pageOf": "Page {page} of {total}",
  "common.networkError": "Network error — could not reach the server.",
  "common.justNow": "just now",
  "common.minutesAgo": "{count}m ago",
  "common.hoursAgo": "{count}h ago",
  "common.daysAgo": "{count}d ago",
  "common.monthsAgo": "{count}mo ago",
  "common.version": "Version",

  // --- Dashboard ----------------------------------------------------------
  "dashboard.title": "Dashboard",
  "dashboard.description": "Authorized scope, ranked by research opportunity.",
  "dashboard.opportunities": "Today's Opportunities",
  "dashboard.opportunitiesSubtitle":
    "Highest research-opportunity scores across active authorized scope.",
  "dashboard.allAssets": "All assets",
  "dashboard.allChanges": "All changes",
  "dashboard.recentChanges": "Recent changes",
  "dashboard.noOpportunities": "No scored opportunities yet",
  "dashboard.noOpportunitiesHelp":
    "Configure a provider integration, run a sync, then let the AI queue drain. Unevaluated scope is never shown as a zero score.",
  "dashboard.noChanges": "No changes recorded",
  "dashboard.noChangesHelp":
    "Change events appear after the second sync, once there is a previous snapshot to compare against.",
  "dashboard.processJobs": "Process {count} AI job",
  "dashboard.processJobs_plural": "Process {count} AI jobs",
  "dashboard.processing": "Processing…",
  "dashboard.processed": "Processed {processed}; {pending} still queued.",
  "dashboard.queueFailed": "Failed to process the queue.",

  // --- Metrics ------------------------------------------------------------
  "metric.programs": "Programs",
  "metric.activeScopes": "Active scopes",
  "metric.newAssets": "New assets",
  "metric.newAssetsHint": "last 7 days",
  "metric.changesToday": "Changes today",
  "metric.highOpportunity": "High opportunity",
  "metric.highOpportunityHint": "score 80+",
  "metric.pendingAi": "Pending AI",
  "metric.pendingAiHint": "evaluations queued",
  "metric.failedJobs": "{count} failed job(s)",
  "metric.findings": "Findings",
  "metric.totalPayout": "Total payout",

  // --- Assets -------------------------------------------------------------
  "assets.title": "Assets",
  "assets.description":
    "Authorized scope across every connected provider. Sorted by research opportunity.",
  "assets.count": "{count} asset",
  "assets.count_plural": "{count} assets",
  "assets.unevaluatedNote":
    "{count} not yet evaluated — shown as “—”, never as a zero score.",
  "assets.empty": "No assets match these filters",
  "assets.emptyHelp":
    "Connect a provider under Integrations and run a sync to populate the inventory.",
  "assets.invalidFilters": "Some filters were invalid and have been reset.",

  "assets.col.score": "AI Score",
  "assets.col.asset": "Asset",
  "assets.col.program": "Program",
  "assets.col.provider": "Provider",
  "assets.col.type": "Type",
  "assets.col.status": "Status",
  "assets.col.bounty": "Bounty",
  "assets.col.maxSeverity": "Max sev",
  "assets.col.tags": "Tags",
  "assets.col.lastChanged": "Last changed",
  "assets.col.coverage": "Coverage",
  "assets.sessions": "{count} session",
  "assets.sessions_plural": "{count} sessions",

  "filter.search": "Search",
  "filter.searchPlaceholder": "asset identifier",
  "filter.provider": "Provider",
  "filter.program": "Program",
  "filter.type": "Type",
  "filter.scopeStatus": "Scope status",
  "filter.scopeStatusDefault": "In scope (default)",
  "filter.maxSeverity": "Max severity",
  "filter.bountyEligible": "Bounty eligible",
  "filter.tag": "Tag",
  "filter.minScore": "Min score",
  "filter.maxScore": "Max score",
  "filter.isNew": "New (7d)",
  "filter.recentlyChanged": "Recently changed",
  "filter.notEvaluated": "Not evaluated",
  "filter.notReviewed": "Not reviewed",

  "sort.opportunity": "Opportunity score",
  "sort.newest": "Newest",
  "sort.recentlyChanged": "Recently changed",
  "sort.severity": "Highest max severity",
  "sort.leastReviewed": "Least reviewed",

  // --- Asset detail -------------------------------------------------------
  "asset.scopeClassification": "Scope Classification",
  "asset.researchAuthorization": "Research Authorization",
  "asset.assetType": "Asset type",
  "asset.bountyEligible": "Bounty eligible",
  "asset.submissionEligible": "Submission eligible",
  "asset.maxSeverity": "Max severity",
  "asset.opportunity": "Opportunity",
  "asset.providerData": "Provider Data",
  "asset.scopeInstructions": "Scope instructions",
  "asset.noInstructions": "No instructions published for this scope",
  "asset.sourceUpdated": "Source updated",
  "asset.firstSeen": "First seen",
  "asset.lastSeen": "Last seen",
  "asset.lastSync": "Last sync",
  "asset.provenance": "Provenance",
  "asset.provenanceProvider": "Provider verified",
  "asset.provenanceManual": "Manual entry",
  "asset.programStatus": "Program status",
  "asset.visibility": "Visibility",
  "asset.safeHarbor": "Safe harbour",
  "asset.bountyRange": "Bounty range",
  "asset.openOnProvider": "Open program on {provider}",
  "asset.authorizedNote":
    "Provider data confirms this asset is in scope and eligible for submission. Authorization is established by provider data only — never by AI output.",
  "asset.verifiedAt": "Authorization gate · verified",

  // --- Authorization ------------------------------------------------------
  "authz.verified": "VERIFIED",
  "authz.userConfirmed": "USER CONFIRMED",
  "authz.notVerified": "NOT VERIFIED",
  "authz.reason.SCOPE_NOT_FOUND": "The asset does not exist in the inventory.",
  "authz.reason.SCOPE_REMOVED":
    "The asset was removed from the program scope and is no longer authorized.",
  "authz.reason.SCOPE_OUT_OF_SCOPE": "The provider lists this asset as out of scope.",
  "authz.reason.SCOPE_STATUS_UNKNOWN": "The authorization status of this asset is ambiguous.",
  "authz.reason.SUBMISSION_NOT_ELIGIBLE":
    "The provider marks this asset as not eligible for submission.",
  "authz.reason.PROGRAM_NOT_ACTIVE": "The program is not currently active.",
  "authz.reason.PROVIDER_DISABLED":
    "The provider integration is disabled, so scope cannot be verified.",
  "authz.reason.DATA_STALE":
    "The provider data is older than the configured freshness limit and must be re-synced.",
  "authz.reason.NO_PROVIDER_SNAPSHOT": "No provider-backed snapshot exists for this asset.",
  "authz.reason.MANUAL_NOT_CONFIRMED":
    "This manual asset has not been explicitly confirmed as authorized.",

  // --- AI evaluation panel ------------------------------------------------
  "ai.evaluation": "AI Evaluation",
  "ai.evaluationSource": "Evaluation Source",
  "ai.sourceModel": "AI MODEL",
  "ai.sourceHeuristic": "HEURISTIC",
  "ai.offlineRuleEngine": "Offline rule engine",
  "ai.provider": "Provider",
  "ai.model": "Model",
  "ai.notEvaluated": "Not evaluated yet",
  "ai.queued": "Evaluation queued",
  "ai.lastFailed": "The last evaluation failed",
  "ai.evaluateHelp":
    "Use “Re-evaluate with AI” to queue an evaluation, or run the worker to drain the queue.",
  "ai.reevaluate": "Re-evaluate with AI",
  "ai.evaluating": "Evaluating…",
  "ai.evaluatedScore": "Evaluated — score {score}.",
  "ai.evaluationFailed": "The evaluation failed; see the AI panel for details.",
  "ai.evaluationQueued": "Queued. Run the worker to process it.",
  "ai.confidence": "Confidence",
  "ai.evaluatedAt": "Evaluated",
  "ai.whyInteresting": "Why this is interesting",
  "ai.dimensionScores": "Dimension scores",
  "ai.scoreNote":
    "The final score is computed by the application from these weighted dimensions, never taken directly from the model.",
  "ai.tags": "Tags",
  "ai.suggestedResearch": "Suggested Research Areas",
  "ai.warnings": "Warnings",
  "ai.evaluationHistory": "AI Evaluation History",
  "ai.noEvaluations": "No evaluations recorded",
  "ai.writtenInOtherLanguage":
    "This evaluation was written in {language}. Re-evaluate to regenerate it in the current language.",

  // --- Score dimensions ---------------------------------------------------
  "score.businessValue": "Business Value",
  "score.attackSurface": "Attack Surface",
  "score.freshness": "Freshness",
  "score.researchPotential": "Research Potential",
  "score.complexity": "Complexity",
  "score.policyFit": "Policy Fit",
  "score.duplicateRisk": "Duplicate Risk",
  "score.duplicateRiskHelp":
    "0 = low risk, 100 = high risk. The Opportunity Score formula inverts this internally.",
  "score.opportunityScore": "Opportunity Score",
  "score.researchOpportunity": "Research Opportunity",
  "score.notEvaluated": "Not evaluated",
  "score.aiPending": "AI Pending",
  "score.aiFailed": "AI Failed",
  "score.stale": "Stale",
  "score.weight": "Weight",

  // --- Opportunity bands --------------------------------------------------
  "band.HIGH": "High",
  "band.MEDIUM_HIGH": "Medium High",
  "band.MEDIUM": "Medium",
  "band.LOW": "Low",

  // --- History ------------------------------------------------------------
  "history.scope": "Scope History",
  "history.change": "Change History",
  "history.noChanges": "No changes recorded for this asset",
  "history.noVersions": "No versions recorded",
  "history.before": "Before",
  "history.after": "After",
  "history.validFrom": "Valid from",
  "history.validTo": "Valid to",
  "history.current": "Current",
  "history.contentHash": "Content hash",
  "history.versions": "{count} version(s)",
  "history.changesRecorded": "{count} recorded change(s)",

  // --- Programs -----------------------------------------------------------
  "programs.title": "Programs",
  "programs.description":
    "Every program imported from a connected provider, plus manually entered programs.",
  "programs.count": "{count} program",
  "programs.count_plural": "{count} programs",
  "programs.empty": "No programs imported",
  "programs.emptyHelp": "Configure a provider under Integrations and run a sync.",
  "programs.col.handle": "Handle",
  "programs.col.scopes": "Scopes",
  "programs.col.active": "Active",
  "programs.col.bountyMax": "Bounty max",
  "programs.col.lastSynced": "Last synced",

  // --- Changes ------------------------------------------------------------
  "changes.title": "Changes",
  "changes.description": "Every meaningful difference detected between provider snapshots.",
  "changes.count": "{count} change event",
  "changes.count_plural": "{count} change events",
  "changes.empty": "No change events",
  "changes.emptyHelp":
    "Changes are recorded from the second sync onward, once a previous snapshot exists to compare against.",
  "changes.type": "Change type",
  "changes.importance": "Importance",
  "changes.filter": "Filter",
  "changes.programLevel": "Program-level change",

  "changeType.ASSET_ADDED": "Asset added",
  "changeType.ASSET_REMOVED": "Asset removed",
  "changeType.ASSET_CHANGED": "Asset changed",
  "changeType.BOUNTY_ELIGIBILITY_CHANGED": "Bounty eligibility changed",
  "changeType.SUBMISSION_ELIGIBILITY_CHANGED": "Submission eligibility changed",
  "changeType.MAX_SEVERITY_CHANGED": "Max severity changed",
  "changeType.INSTRUCTION_CHANGED": "Instruction changed",
  "changeType.POLICY_CHANGED": "Policy changed",
  "changeType.PROGRAM_CHANGED": "Program changed",

  "importance.LOW": "Low",
  "importance.MEDIUM": "Medium",
  "importance.HIGH": "High",
  "importance.CRITICAL_ATTENTION": "Critical attention",
  "importance.criticalHelp":
    "High research-review priority. This is not a vulnerability severity.",

  // --- Statuses -----------------------------------------------------------
  "scopeStatus.IN_SCOPE": "In scope",
  "scopeStatus.OUT_OF_SCOPE": "Out of scope",
  "scopeStatus.REMOVED": "Removed",
  "scopeStatus.UNKNOWN": "Unknown",

  "severity.CRITICAL": "Critical",
  "severity.HIGH": "High",
  "severity.MEDIUM": "Medium",
  "severity.LOW": "Low",
  "severity.NONE": "None",

  "programStatus.ACTIVE": "Active",
  "programStatus.PAUSED": "Paused",
  "programStatus.ARCHIVED": "Archived",
  "programStatus.UNKNOWN": "Unknown",

  "visibility.PUBLIC": "Public",
  "visibility.PRIVATE": "Private",
  "visibility.UNKNOWN": "Unknown",

  "badge.new": "New",
  "badge.changed": "Changed",
  "badge.removed": "Removed",

  "connection.CONNECTED": "Connected",
  "connection.NOT_CONFIGURED": "Not configured",
  "connection.AUTH_ERROR": "Auth error",
  "connection.PERMISSION_ERROR": "Permission error",
  "connection.RATE_LIMITED": "Rate limited",
  "connection.API_ERROR": "API error",
  "connection.UNSUPPORTED": "Unsupported",
  "connection.DISABLED": "Disabled",
  "connection.READY": "Ready",

  "syncStatus.RUNNING": "Running",
  "syncStatus.SUCCESS": "Success",
  "syncStatus.PARTIAL": "Partial",
  "syncStatus.FAILED": "Failed",

  "evalStatus.PENDING": "Pending",
  "evalStatus.PROCESSING": "Processing",
  "evalStatus.COMPLETED": "Completed",
  "evalStatus.FAILED": "Failed",
  "evalStatus.STALE": "Stale",

  // --- Settings shell -----------------------------------------------------
  "settings.title": "Settings",
  "settings.groupGeneral": "General",
  "settings.groupIntelligence": "Intelligence",
  "settings.groupIntegrations": "Integrations",
  "settings.appearance": "Appearance",
  "settings.language": "Language",
  "settings.ai": "AI",
  "settings.integrations": "API Integrations",
  "settings.nav": "Settings sections",

  // --- Appearance ---------------------------------------------------------
  "appearance.title": "Appearance",
  "appearance.description": "Choose how the interface looks on this account.",
  "appearance.theme": "Theme",
  "appearance.light": "Light",
  "appearance.dark": "Dark",
  "appearance.system": "System",
  "appearance.lightHelp": "Bright surfaces, dark text.",
  "appearance.darkHelp": "Near-black surfaces, light text.",
  "appearance.systemHelp": "Follow your operating system setting.",
  "appearance.saved": "Theme updated.",

  // --- Language -----------------------------------------------------------
  "language.title": "Language",
  "language.description": "Choose the language used across the interface.",
  "language.select": "Interface language",
  "language.saved": "Language updated.",
  "language.aiNote":
    "New AI evaluations are generated in the selected language. Existing evaluations keep the language they were written in — re-evaluate an asset to regenerate it. Technical identifiers such as domain names, asset types and provider names are never translated.",

  // --- AI settings --------------------------------------------------------
  "aiSettings.title": "AI Settings",
  "aiSettings.description":
    "Configure the model that scores and explains scope. Keys are encrypted at rest and never returned.",
  "aiSettings.provider": "AI Provider",
  "aiSettings.apiKey": "API Key",
  "aiSettings.apiKeyConfigured": "Configured",
  "aiSettings.apiKeyNotConfigured": "Not configured",
  "aiSettings.apiKeyPlaceholder": "Paste a new key to replace the stored one",
  "aiSettings.apiKeyHelp":
    "Stored encrypted with AES-256-GCM. It is never displayed again and never sent to the browser.",
  "aiSettings.model": "Model",
  "aiSettings.customModel": "Custom model ID",
  "aiSettings.customModelPlaceholder": "Enter an exact model id",
  "aiSettings.baseUrl": "Base URL",
  "aiSettings.baseUrlHelp": "HTTPS origin of an OpenAI-compatible API.",
  "aiSettings.status": "Status",
  "aiSettings.testConnection": "Test Connection",
  "aiSettings.testing": "Testing…",
  "aiSettings.saveSettings": "Save Settings",
  "aiSettings.deleteKey": "Delete API Key",
  "aiSettings.deleteKeyConfirm": "Delete the stored API key? Evaluation falls back to the rule engine.",
  "aiSettings.saved": "AI settings saved.",
  "aiSettings.keyDeleted": "API key deleted.",
  "aiSettings.features": "AI Features",
  "aiSettings.enabled": "AI enabled",
  "aiSettings.scopeEvaluation": "Scope Evaluation",
  "aiSettings.changeAnalysis": "Change Analysis",
  "aiSettings.autoEvaluateNew": "Automatically evaluate new scopes",
  "aiSettings.autoReevaluateChanged": "Automatically re-evaluate changed scopes",
  "aiSettings.heuristicFallback": "Fallback heuristic evaluation",
  "aiSettings.heuristicFallbackHelp":
    "When the model is unavailable, score with the offline rule engine instead of leaving scope unevaluated. Results are labelled HEURISTIC, never AI.",
  "aiSettings.advanced": "Advanced",
  "aiSettings.temperature": "Temperature",
  "aiSettings.maxTokens": "Max tokens",
  "aiSettings.notConfiguredTitle": "AI Provider — Not configured",
  "aiSettings.notConfiguredBody":
    "AI model evaluation is disabled. The application is currently using heuristic/rule-based scoring.",
  "aiSettings.envKeyNote":
    "An API key is also present in the environment (ANTHROPIC_API_KEY). Settings saved here take precedence.",

  "aiTest.connected": "Connected",
  "aiTest.invalidKey": "Invalid API key",
  "aiTest.permissionDenied": "Permission denied",
  "aiTest.rateLimited": "Rate limited",
  "aiTest.unavailable": "Provider unavailable",
  "aiTest.incomplete": "Configuration incomplete",

  // --- AI summary card ----------------------------------------------------
  "aiSummary.title": "AI Intelligence",
  "aiSummary.manage": "Manage AI Settings",
  "aiSummary.configure": "Configure AI",
  "aiSummary.heuristicProvider": "Heuristic fallback",
  "aiSummary.noKeyStatus": "No AI API key configured",

  // --- Integrations -------------------------------------------------------
  "integrations.title": "API Integrations",
  "integrations.description":
    "Connect bug bounty providers. Credentials are encrypted at rest with AES-256-GCM and are never returned by the API.",
  "integrations.programs": "Programs",
  "integrations.activeScopes": "Active scopes",
  "integrations.credential": "Credential",
  "integrations.notRequired": "Not required",
  "integrations.lastTest": "Last test",
  "integrations.lastSuccessfulSync": "Last successful sync",
  "integrations.lastAttemptedSync": "Last attempted sync",
  "integrations.lastRun": "Last run",
  "integrations.configure": "Configure",
  "integrations.editCredentials": "Edit credentials",
  "integrations.testConnection": "Test Connection",
  "integrations.syncNow": "Sync Now",
  "integrations.syncing": "Syncing…",
  "integrations.enable": "Enable",
  "integrations.disable": "Disable",
  "integrations.disconnect": "Disconnect",
  "integrations.syncHistory": "Sync history",
  "integrations.noCredentials": "No credentials",
  "integrations.enableFirst": "Enable the integration first.",
  "integrations.credentialsSaved": "Credentials saved and encrypted.",
  "integrations.credentialsDeleted": "Credentials deleted.",
  "integrations.integrationEnabled": "Integration enabled.",
  "integrations.integrationDisabled": "Integration disabled.",
  "integrations.connected": "Connected.",
  "integrations.testFailed": "Connection test failed.",
  "integrations.saveCredentials": "Save credentials",
  "integrations.documentation": "Documentation",
  "integrations.syncSummary":
    "{status}: {programs} programs, {scopes} scopes, {changes} changes, {jobs} AI jobs queued.",
  "integrations.requestFailed": "Request failed ({status}).",

  // --- Sync history -------------------------------------------------------
  "syncHistory.title": "{provider} sync history",
  "syncHistory.description":
    "Every synchronisation attempt, with the counters and error recorded at the time.",
  "syncHistory.back": "Back to integrations",
  "syncHistory.runs": "{count} run",
  "syncHistory.runs_plural": "{count} runs",
  "syncHistory.empty": "No sync runs recorded for this provider",
  "syncHistory.col.status": "Status",
  "syncHistory.col.trigger": "Trigger",
  "syncHistory.col.started": "Started",
  "syncHistory.col.duration": "Duration",
  "syncHistory.col.created": "Created",
  "syncHistory.col.updated": "Updated",
  "syncHistory.col.removed": "Removed",
  "syncHistory.col.changes": "Changes",
  "syncHistory.col.aiJobs": "AI jobs",
  "syncHistory.col.rateLimits": "429s",
  "syncHistory.col.retries": "Retries",
  "syncHistory.col.error": "Error",

  // --- AI Supporter -------------------------------------------------------
  "nav.aiSupporter": "AI Supporter",
  "aiSupporter.title": "AI Supporter",
  "aiSupporter.description":
    "AI-supported recommendations. Deterministic filters narrow the whole inventory to eligible scope for free; the model then ranks and explains a bounded, high-value slice.",
  "aiSupporter.funnel": "Prioritisation funnel",
  "aiSupporter.funnelNote":
    "Each step is a plain count — no AI, instant. Only the final slice is worth a model call.",
  "aiSupporter.allScopes": "All scopes",
  "aiSupporter.inScope": "In scope",
  "aiSupporter.eligible": "Eligible",
  "aiSupporter.eligibleHint": "in scope · submission · bounty",
  "aiSupporter.highSeverity": "High / Critical",
  "aiSupporter.evaluated": "Evaluated",
  "aiSupporter.recommended": "Recommended",
  "aiSupporter.recommendedHint": "score 70+",
  "aiSupporter.candidatePool": "Awaiting evaluation",
  "aiSupporter.sourceModel": "Recommendations are backed by {model}.",
  "aiSupporter.sourceHeuristic":
    "No AI model is configured — recommendations use the offline rule engine and are labelled HEURISTIC, not AI. Configure a model under Settings → AI.",
  "aiSupporter.recommendations": "Recommendations",
  "aiSupporter.focus": "Focus",
  "aiSupporter.focusAll": "All eligible",
  "aiSupporter.focusHighValue": "High-value asset types",
  "aiSupporter.batchSize": "Batch size",
  "aiSupporter.generate": "Generate recommendations",
  "aiSupporter.generating": "Evaluating…",
  "aiSupporter.generated": "Evaluated {evaluated} scope(s); {failed} failed.",
  "aiSupporter.generateHelp":
    "Evaluates the highest-value un-evaluated eligible scope first. Bounded per run to control cost.",
  "aiSupporter.empty": "No recommendations yet",
  "aiSupporter.emptyHelp":
    "Your eligible scope has not been evaluated yet. Generate a batch to rank the highest-value assets.",
  "aiSupporter.open": "Open",
  "aiSupporter.viewInAssets": "View all in Assets",
} as const;

export type MessageKey = keyof typeof en;
export type Messages = Record<MessageKey, string>;
