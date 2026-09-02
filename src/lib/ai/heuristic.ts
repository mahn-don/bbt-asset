import {
  normalizeTags,
  type AiConnectionResult,
  type AiProvider,
  type AiResult,
  type ChangeAnalysisInput,
  type ChangeAnalysisOutput,
  type PolicyInput,
  type PolicySummary,
  type ScopeEvaluationInput,
  type ScopeEvaluationOutput,
} from "@/lib/ai/types";

/**
 * Deterministic, offline evaluation provider.
 *
 * This is not a model. It is a rule-based estimator that produces the same
 * seven dimension scores from the same metadata, with no network call. It
 * exists for three reasons:
 *
 *  1. Tests must assert exact behaviour of the evaluation pipeline without
 *     making paid, non-deterministic API calls.
 *  2. The platform stays fully usable with no ANTHROPIC_API_KEY configured.
 *  3. It gives a sane floor when the model is unavailable.
 *
 * Every evaluation it produces is stored with `aiProvider = "heuristic"`, and
 * the UI labels it as a rule-based estimate rather than a model evaluation -
 * it is never passed off as AI output.
 */

const HIGH_VALUE_KEYWORDS: { pattern: RegExp; tag: string; value: number }[] = [
  { pattern: /\b(pay|payment|billing|checkout|invoice|wallet)\b/i, tag: "payments", value: 30 },
  { pattern: /\b(account|auth|login|sso|identity|idp)\b/i, tag: "authentication", value: 25 },
  { pattern: /\b(admin|console|manage|internal|ops)\b/i, tag: "admin", value: 25 },
  { pattern: /\b(api|graphql|rest)\b/i, tag: "api", value: 20 },
  { pattern: /\b(oauth|oidc|saml|token)\b/i, tag: "oauth", value: 15 },
  { pattern: /\b(upload|file|media|storage|s3)\b/i, tag: "upload", value: 15 },
  { pattern: /\b(webhook|callback|hook)\b/i, tag: "webhook", value: 15 },
  { pattern: /\b(staging|stage|dev|test|qa|sandbox|uat)\b/i, tag: "staging", value: -5 },
  { pattern: /\b(legacy|old|v1|deprecated)\b/i, tag: "legacy", value: 5 },
];

const ATTACK_SURFACE_BY_TYPE: Record<string, number> = {
  API: 85,
  WILDCARD: 90,
  URL: 65,
  DOMAIN: 60,
  REPOSITORY: 70,
  ANDROID: 70,
  IOS: 70,
  IP: 45,
  CIDR: 55,
  OTHER: 35,
};

const COMPLEXITY_BY_TYPE: Record<string, number> = {
  API: 70,
  WILDCARD: 75,
  URL: 60,
  DOMAIN: 50,
  REPOSITORY: 65,
  ANDROID: 70,
  IOS: 70,
  IP: 35,
  CIDR: 40,
  OTHER: 30,
};

const SEVERITY_VALUE: Record<string, number> = {
  CRITICAL: 100,
  HIGH: 80,
  MEDIUM: 55,
  LOW: 30,
  NONE: 10,
};


function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * Localised prose for the rule engine.
 *
 * The rule engine writes its own sentences, so it localises them itself rather
 * than going through a model. Technical identifiers (asset identifier, asset
 * type, severity, scope status) are interpolated verbatim and never translated.
 */
interface Phrases {
  ruleBasedWarning: string;
  noInstructions: string;
  noHistory: string;
  notAuthorized: (status: string) => string;
  summaryLead: (asset: string, type: string, program: string) => string;
  bountyYes: string;
  bountyNo: string;
  fresh: string;
  broadSurface: string;
  businessCritical: string;
  maxSeverity: (severity: string) => string;
  reasoning: (v: {
    type: string;
    attackSurface: number;
    businessValue: number;
    freshness: number;
    policyFit: number;
  }) => string;
  researchAreas: Record<string, string[]>;
  changeAdded: (asset: string, type: string, program: string) => string;
  changeBountyYes: string;
  changeBountyNo: string;
  changeCritical: string;
  changeRemoved: (asset: string, program: string) => string;
  changeGeneric: (
    type: string,
    target: string,
    field: string | null,
    from: string,
    to: string,
  ) => string;
}

const EN_AREAS: Record<string, string[]> = {
  API: ["API access-control review", "authorization model", "business logic"],
  WILDCARD: ["subdomain inventory review", "authentication boundaries", "tenant isolation"],
  URL: ["authentication boundaries", "authorization model", "business logic"],
  DOMAIN: ["authentication boundaries", "authorization model"],
  REPOSITORY: ["repository security review", "secret handling review", "dependency review"],
  ANDROID: ["mobile/backend interaction", "authentication boundaries", "local data handling"],
  IOS: ["mobile/backend interaction", "authentication boundaries", "local data handling"],
  IP: ["exposed service inventory review"],
  CIDR: ["exposed service inventory review"],
  OTHER: ["scope clarification with the program"],
};

const VI_AREAS: Record<string, string[]> = {
  API: ["R\u00e0 so\u00e1t ki\u1ec3m so\u00e1t truy c\u1eadp API", "M\u00f4 h\u00ecnh ph\u00e2n quy\u1ec1n", "Logic nghi\u1ec7p v\u1ee5"],
  WILDCARD: ["R\u00e0 so\u00e1t danh s\u00e1ch subdomain", "Ranh gi\u1edbi x\u00e1c th\u1ef1c", "C\u00f4 l\u1eadp gi\u1eefa c\u00e1c tenant"],
  URL: ["Ranh gi\u1edbi x\u00e1c th\u1ef1c", "M\u00f4 h\u00ecnh ph\u00e2n quy\u1ec1n", "Logic nghi\u1ec7p v\u1ee5"],
  DOMAIN: ["Ranh gi\u1edbi x\u00e1c th\u1ef1c", "M\u00f4 h\u00ecnh ph\u00e2n quy\u1ec1n"],
  REPOSITORY: ["R\u00e0 so\u00e1t b\u1ea3o m\u1eadt m\u00e3 ngu\u1ed3n", "R\u00e0 so\u00e1t c\u00e1ch x\u1eed l\u00fd secret", "R\u00e0 so\u00e1t ph\u1ee5 thu\u1ed9c"],
  ANDROID: ["T\u01b0\u01a1ng t\u00e1c gi\u1eefa \u1ee9ng d\u1ee5ng di \u0111\u1ed9ng v\u00e0 backend", "Ranh gi\u1edbi x\u00e1c th\u1ef1c", "X\u1eed l\u00fd d\u1eef li\u1ec7u c\u1ee5c b\u1ed9"],
  IOS: ["T\u01b0\u01a1ng t\u00e1c gi\u1eefa \u1ee9ng d\u1ee5ng di \u0111\u1ed9ng v\u00e0 backend", "Ranh gi\u1edbi x\u00e1c th\u1ef1c", "X\u1eed l\u00fd d\u1eef li\u1ec7u c\u1ee5c b\u1ed9"],
  IP: ["R\u00e0 so\u00e1t c\u00e1c d\u1ecbch v\u1ee5 \u0111ang m\u1edf"],
  CIDR: ["R\u00e0 so\u00e1t c\u00e1c d\u1ecbch v\u1ee5 \u0111ang m\u1edf"],
  OTHER: ["L\u00e0m r\u00f5 ph\u1ea1m vi v\u1edbi ch\u01b0\u01a1ng tr\u00ecnh"],
};

const PHRASES: Record<string, Phrases> = {
  en: {
    ruleBasedWarning:
      "Rule-based estimate: produced by the offline rule engine, not by an AI model.",
    noInstructions: "No scope instructions were published by the provider.",
    noHistory: "No research-coverage history exists yet, so duplicate risk is a weak estimate.",
    notAuthorized: (status) => `Scope status is ${status}; this asset is not currently authorized.`,
    summaryLead: (asset, type, program) => `${asset} is a ${type} asset on ${program}.`,
    bountyYes: "It is bounty eligible.",
    bountyNo: "It is not bounty eligible.",
    fresh: "It is newly added or recently changed.",
    broadSurface: "The asset type implies a broad functional surface.",
    businessCritical: "Identifier keywords suggest business-critical functionality.",
    maxSeverity: (severity) => `Maximum severity is ${severity}.`,
    reasoning: (v) =>
      [
        `Asset type ${v.type} implies an attack-surface estimate of ${v.attackSurface}.`,
        `Business-value signals in the identifier and instructions score ${v.businessValue}.`,
        `Freshness scores ${v.freshness} based on age and recorded changes.`,
        `Policy fit scores ${v.policyFit} from submission and bounty eligibility.`,
      ].join(" "),
    researchAreas: EN_AREAS,
    changeAdded: (asset, type, program) => `New ${type} scope ${asset} was added to ${program}.`,
    changeBountyYes: " It is bounty eligible.",
    changeBountyNo: " It is not bounty eligible.",
    changeCritical: " Maximum severity is CRITICAL.",
    changeRemoved: (asset, program) =>
      `${asset} was removed from ${program} scope and is no longer authorized.`,
    changeGeneric: (type, target, field, from, to) =>
      field ? `${type} on ${target} (${field}: ${from} \u2192 ${to}).` : `${type} on ${target}.`,
  },
  vi: {
    ruleBasedWarning:
      "\u01af\u1edbc l\u01b0\u1ee3ng theo quy t\u1eafc: \u0111\u01b0\u1ee3c t\u1ea1o b\u1edfi b\u1ed9 quy t\u1eafc ngo\u1ea1i tuy\u1ebfn, kh\u00f4ng ph\u1ea3i b\u1edfi m\u00f4 h\u00ecnh AI.",
    noInstructions: "N\u1ec1n t\u1ea3ng kh\u00f4ng c\u00f4ng b\u1ed1 h\u01b0\u1edbng d\u1eabn ph\u1ea1m vi cho t\u00e0i s\u1ea3n n\u00e0y.",
    noHistory:
      "Ch\u01b0a c\u00f3 l\u1ecbch s\u1eed nghi\u00ean c\u1ee9u n\u00e0o, n\u00ean r\u1ee7i ro tr\u00f9ng l\u1eb7p ch\u1ec9 l\u00e0 \u01b0\u1edbc l\u01b0\u1ee3ng y\u1ebfu.",
    notAuthorized: (status) =>
      `Tr\u1ea1ng th\u00e1i ph\u1ea1m vi l\u00e0 ${status}; t\u00e0i s\u1ea3n n\u00e0y hi\u1ec7n kh\u00f4ng \u0111\u01b0\u1ee3c \u1ee7y quy\u1ec1n.`,
    summaryLead: (asset, type, program) =>
      `${asset} l\u00e0 t\u00e0i s\u1ea3n lo\u1ea1i ${type} thu\u1ed9c ch\u01b0\u01a1ng tr\u00ecnh ${program}.`,
    bountyYes: "T\u00e0i s\u1ea3n n\u00e0y \u0111\u1ee7 \u0111i\u1ec1u ki\u1ec7n nh\u1eadn th\u01b0\u1edfng.",
    bountyNo: "T\u00e0i s\u1ea3n n\u00e0y kh\u00f4ng \u0111\u1ee7 \u0111i\u1ec1u ki\u1ec7n nh\u1eadn th\u01b0\u1edfng.",
    fresh: "T\u00e0i s\u1ea3n v\u1eeba \u0111\u01b0\u1ee3c th\u00eam ho\u1eb7c v\u1eeba thay \u0111\u1ed5i g\u1ea7n \u0111\u00e2y.",
    broadSurface: "Lo\u1ea1i t\u00e0i s\u1ea3n n\u00e0y cho th\u1ea5y b\u1ec1 m\u1eb7t ch\u1ee9c n\u0103ng r\u1ed9ng.",
    businessCritical:
      "C\u00e1c t\u1eeb kh\u00f3a trong \u0111\u1ecbnh danh cho th\u1ea5y ch\u1ee9c n\u0103ng quan tr\u1ecdng v\u1edbi ho\u1ea1t \u0111\u1ed9ng kinh doanh.",
    maxSeverity: (severity) => `M\u1ee9c \u0111\u1ed9 nghi\u00eam tr\u1ecdng t\u1ed1i \u0111a l\u00e0 ${severity}.`,
    reasoning: (v) =>
      [
        `Lo\u1ea1i t\u00e0i s\u1ea3n ${v.type} cho \u01b0\u1edbc l\u01b0\u1ee3ng b\u1ec1 m\u1eb7t t\u1ea5n c\u00f4ng l\u00e0 ${v.attackSurface}.`,
        `T\u00edn hi\u1ec7u gi\u00e1 tr\u1ecb kinh doanh trong \u0111\u1ecbnh danh v\u00e0 h\u01b0\u1edbng d\u1eabn \u0111\u1ea1t ${v.businessValue}.`,
        `\u0110\u1ed9 m\u1edbi \u0111\u1ea1t ${v.freshness} d\u1ef1a tr\u00ean tu\u1ed5i v\u00e0 c\u00e1c thay \u0111\u1ed5i \u0111\u00e3 ghi nh\u1eadn.`,
        `M\u1ee9c ph\u00f9 h\u1ee3p ch\u00ednh s\u00e1ch \u0111\u1ea1t ${v.policyFit} d\u1ef1a tr\u00ean \u0111i\u1ec1u ki\u1ec7n g\u1eedi b\u00e1o c\u00e1o v\u00e0 nh\u1eadn th\u01b0\u1edfng.`,
      ].join(" "),
    researchAreas: VI_AREAS,
    changeAdded: (asset, type, program) =>
      `Ph\u1ea1m vi ${type} m\u1edbi ${asset} \u0111\u00e3 \u0111\u01b0\u1ee3c th\u00eam v\u00e0o ${program}.`,
    changeBountyYes: " T\u00e0i s\u1ea3n n\u00e0y \u0111\u1ee7 \u0111i\u1ec1u ki\u1ec7n nh\u1eadn th\u01b0\u1edfng.",
    changeBountyNo: " T\u00e0i s\u1ea3n n\u00e0y kh\u00f4ng \u0111\u1ee7 \u0111i\u1ec1u ki\u1ec7n nh\u1eadn th\u01b0\u1edfng.",
    changeCritical: " M\u1ee9c \u0111\u1ed9 nghi\u00eam tr\u1ecdng t\u1ed1i \u0111a l\u00e0 CRITICAL.",
    changeRemoved: (asset, program) =>
      `${asset} \u0111\u00e3 b\u1ecb lo\u1ea1i kh\u1ecfi ph\u1ea1m vi c\u1ee7a ${program} v\u00e0 kh\u00f4ng c\u00f2n \u0111\u01b0\u1ee3c \u1ee7y quy\u1ec1n.`,
    changeGeneric: (type, target, field, from, to) =>
      field ? `${type} tr\u00ean ${target} (${field}: ${from} \u2192 ${to}).` : `${type} tr\u00ean ${target}.`,
  },
};

function phrasesFor(language: string): Phrases {
  return PHRASES[language] ?? (PHRASES.en as Phrases);
}

export class HeuristicAiProvider implements AiProvider {
  readonly name = "heuristic";
  readonly model = "rule-based-v1";
  /** Never AI_MODEL. This engine must never be presented as model output. */
  readonly source = "HEURISTIC" as const;

  /** Always available: there is no remote service and no credential. */
  async testConnection(): Promise<AiConnectionResult> {
    return { status: "CONNECTED", code: "OK", messageKey: "aiTest.connected" };
  }

  async evaluateScope(input: ScopeEvaluationInput): Promise<AiResult<ScopeEvaluationOutput>> {
    const startedAt = Date.now();
    const { scope, program } = input;

    const haystack = `${scope.assetIdentifier} ${scope.instruction ?? ""}`;
    const tags: string[] = [];

    // --- Business value ---------------------------------------------------
    let businessValue = 40;
    for (const keyword of HIGH_VALUE_KEYWORDS) {
      if (keyword.pattern.test(haystack)) {
        businessValue += keyword.value;
        if (keyword.value > 0) tags.push(keyword.tag);
      }
    }
    if (scope.maxSeverity) businessValue += (SEVERITY_VALUE[scope.maxSeverity] ?? 50) * 0.2;
    if (program.bountyMax !== null) {
      businessValue += Math.min(program.bountyMax / 500, 20);
    }
    businessValue = clamp(businessValue);

    // --- Attack surface ---------------------------------------------------
    let attackSurface = ATTACK_SURFACE_BY_TYPE[scope.assetType] ?? 40;
    if (scope.assetIdentifier.includes("*")) attackSurface += 10;
    if (/\b(api|graphql)\b/i.test(haystack)) attackSurface += 5;
    attackSurface = clamp(attackSurface);

    // --- Freshness --------------------------------------------------------
    let freshness: number;
    const age = scope.ageDays;
    const sinceChange = scope.daysSinceLastChange;

    if (sinceChange !== null && sinceChange <= 7) freshness = 95;
    else if (age !== null && age <= 7) freshness = 90;
    else if (sinceChange !== null && sinceChange <= 30) freshness = 75;
    else if (age !== null && age <= 30) freshness = 70;
    else if (age !== null && age <= 90) freshness = 50;
    else if (age !== null && age <= 365) freshness = 30;
    else freshness = 20;

    if (input.recentChanges.some((change) => change.changeType === "ASSET_ADDED")) {
      freshness = Math.max(freshness, 90);
      tags.push("new-asset");
    }
    if (input.recentChanges.length > 0) tags.push("recent-change");
    freshness = clamp(freshness);

    // --- Research potential ----------------------------------------------
    let researchPotential = attackSurface * 0.5 + businessValue * 0.35;
    if (scope.eligibleForBounty) researchPotential += 12;
    if (scope.maxSeverity === "CRITICAL") researchPotential += 8;
    if (!scope.eligibleForSubmission) researchPotential -= 40;
    researchPotential = clamp(researchPotential);

    // --- Complexity -------------------------------------------------------
    let complexity = COMPLEXITY_BY_TYPE[scope.assetType] ?? 35;
    if (/\b(tenant|org|workspace|multi)\b/i.test(haystack)) {
      complexity += 10;
      tags.push("multi-tenant");
    }
    complexity = clamp(complexity);

    // --- Policy fit -------------------------------------------------------
    let policyFit = 50;
    if (scope.eligibleForSubmission) policyFit += 25;
    else policyFit -= 30;
    if (scope.eligibleForBounty) policyFit += 10;
    if (program.safeHarbor === "FULL") policyFit += 10;
    if (program.status !== "ACTIVE") policyFit -= 15;
    if (scope.instruction && /\b(do not|prohibited|forbidden|no automated|out of scope)\b/i.test(scope.instruction)) {
      policyFit -= 15;
    }
    policyFit = clamp(policyFit);

    // --- Duplicate risk ---------------------------------------------------
    // Only signals this system actually holds are used. No global bug bounty
    // statistics are invented.
    let duplicateRisk = 50;
    if (age !== null) {
      if (age <= 14) duplicateRisk -= 25;
      else if (age <= 90) duplicateRisk -= 5;
      else if (age > 365) duplicateRisk += 15;
    }
    if (input.researchHistory) {
      duplicateRisk += Math.min(input.researchHistory.sessionCount * 4, 20);
      duplicateRisk += Math.min(input.researchHistory.duplicateCount * 8, 25);
      if (input.researchHistory.sessionCount === 0) tags.push("low-coverage");
    }
    if (program.visibility === "PRIVATE") duplicateRisk -= 15;
    duplicateRisk = clamp(duplicateRisk);

    // --- Presentation -----------------------------------------------------
    if (scope.assetType === "API") tags.push("api");
    if (scope.assetType === "WILDCARD") tags.push("wildcard");
    if (scope.assetType === "REPOSITORY") tags.push("repository");
    if (scope.assetType === "ANDROID" || scope.assetType === "IOS") tags.push("mobile");
    if (businessValue >= 75) tags.push("high-value");

    const phrases = phrasesFor(input.outputLanguage);

    const warnings: string[] = [phrases.ruleBasedWarning];
    if (!scope.instruction) warnings.push(phrases.noInstructions);
    if (!input.researchHistory) warnings.push(phrases.noHistory);
    if (scope.scopeStatus !== "IN_SCOPE") {
      warnings.push(phrases.notAuthorized(scope.scopeStatus));
    }

    // Confidence tracks how much real signal was available.
    let confidence = 0.45;
    if (scope.instruction) confidence += 0.1;
    if (scope.maxSeverity) confidence += 0.1;
    if (scope.sourceUpdatedAt) confidence += 0.05;
    if (input.researchHistory) confidence += 0.1;
    confidence = Math.min(0.8, Math.round(confidence * 100) / 100);

    const output: ScopeEvaluationOutput = {
      businessValueScore: businessValue,
      attackSurfaceScore: attackSurface,
      freshnessScore: freshness,
      researchPotentialScore: researchPotential,
      complexityScore: complexity,
      policyFitScore: policyFit,
      duplicateRiskScore: duplicateRisk,
      confidence,
      summary: this.buildSummary(input, { attackSurface, freshness, businessValue }),
      reasoningSummary: phrases.reasoning({
        type: scope.assetType,
        attackSurface,
        businessValue,
        freshness,
        policyFit,
      }),
      tags: normalizeTags(tags),
      suggestedResearchAreas:
        phrases.researchAreas[scope.assetType] ?? phrases.researchAreas.OTHER ?? [],
      warnings,
    };

    return {
      output,
      usage: { latencyMs: Date.now() - startedAt },
      model: this.model,
      providerName: this.name,
      source: this.source,
    };
  }

  private buildSummary(
    input: ScopeEvaluationInput,
    scores: { attackSurface: number; freshness: number; businessValue: number },
  ): string {
    const phrases = phrasesFor(input.outputLanguage);
    const parts: string[] = [];

    parts.push(
      phrases.summaryLead(
        input.scope.assetIdentifier,
        input.scope.assetType,
        input.program.name,
      ),
    );

    parts.push(input.scope.eligibleForBounty ? phrases.bountyYes : phrases.bountyNo);

    if (scores.freshness >= 85) parts.push(phrases.fresh);
    if (scores.attackSurface >= 75) parts.push(phrases.broadSurface);
    if (scores.businessValue >= 75) parts.push(phrases.businessCritical);

    if (input.scope.maxSeverity) parts.push(phrases.maxSeverity(input.scope.maxSeverity));

    return parts.join(" ").slice(0, 600);
  }

  async analyzeChange(input: ChangeAnalysisInput): Promise<AiResult<ChangeAnalysisOutput>> {
    const startedAt = Date.now();

    let importance: ChangeAnalysisOutput["importance"] = "LOW";

    const highValueType = ["API", "WILDCARD", "REPOSITORY"].includes(input.assetType ?? "");
    const bountyEligible = input.eligibleForBounty === true;
    const criticalSeverity = input.maxSeverity === "CRITICAL";

    if (input.changeType === "ASSET_ADDED") {
      if (bountyEligible && highValueType && criticalSeverity) importance = "CRITICAL_ATTENTION";
      else if (bountyEligible && highValueType) importance = "HIGH";
      else if (bountyEligible || highValueType) importance = "MEDIUM";
    } else if (input.changeType === "ASSET_REMOVED") {
      importance = "HIGH";
    } else if (input.changeType === "BOUNTY_ELIGIBILITY_CHANGED") {
      importance = input.newValue === "true" ? "HIGH" : "MEDIUM";
    } else if (input.changeType === "MAX_SEVERITY_CHANGED") {
      importance = input.newValue === "CRITICAL" ? "HIGH" : "MEDIUM";
    } else if (input.changeType === "INSTRUCTION_CHANGED" || input.changeType === "POLICY_CHANGED") {
      importance = "MEDIUM";
    }

    const phrases = phrasesFor(input.outputLanguage);

    const summary =
      input.changeType === "ASSET_ADDED"
        ? phrases.changeAdded(
            input.assetIdentifier ?? "",
            input.assetType ?? "asset",
            input.programName,
          ) +
          (bountyEligible ? phrases.changeBountyYes : phrases.changeBountyNo) +
          (criticalSeverity ? phrases.changeCritical : "")
        : input.changeType === "ASSET_REMOVED"
          ? phrases.changeRemoved(input.assetIdentifier ?? "", input.programName)
          : phrases.changeGeneric(
              input.changeType,
              input.assetIdentifier ?? input.programName,
              input.fieldName,
              input.oldValue ?? "none",
              input.newValue ?? "none",
            );

    return {
      output: { importance, summary: summary.slice(0, 500) },
      usage: { latencyMs: Date.now() - startedAt },
      model: this.model,
      providerName: this.name,
      source: this.source,
    };
  }

  async summarizePolicy(input: PolicyInput): Promise<AiResult<PolicySummary>> {
    const startedAt = Date.now();

    const restrictions: string[] = [];
    const patterns: [RegExp, string][] = [
      [/\bno automated (scanning|tools|testing)\b/i, "Automated scanning appears to be prohibited."],
      [/\bdenial[- ]of[- ]service\b/i, "Denial-of-service testing is referenced in the policy."],
      [/\bsocial engineering\b/i, "Social engineering is referenced in the policy."],
      [/\brate limit/i, "The policy references rate limiting requirements."],
      [/\bphysical\b/i, "Physical testing is referenced in the policy."],
    ];

    for (const [pattern, message] of patterns) {
      if (pattern.test(input.policy)) restrictions.push(message);
    }

    const safeHarbor = /safe harbou?r/i.test(input.policy)
      ? /\bgold standard\b/i.test(input.policy)
        ? "FULL"
        : "PARTIAL"
      : "UNKNOWN";

    return {
      output: {
        summary:
          `Rule-based policy scan for ${input.programName} (${input.provider}). ` +
          `${restrictions.length} restriction indicator(s) detected across ${input.policy.length} characters of policy text. ` +
          "This is a keyword scan, not a model summary - read the full policy before testing.",
        keyRestrictions: restrictions,
        safeHarborAssessment: safeHarbor,
      },
      usage: { latencyMs: Date.now() - startedAt },
      model: this.model,
      providerName: this.name,
      source: this.source,
    };
  }
}
