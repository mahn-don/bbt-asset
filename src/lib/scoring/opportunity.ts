/**
 * Opportunity scoring.
 *
 * The model supplies the seven dimension scores; the final Opportunity Score
 * is computed here, deterministically, and is never taken from model output.
 * That keeps ranking auditable and stops a prompt-injected scope instruction
 * from promoting itself to the top of the queue.
 *
 * Weights (per specification):
 *   20% business value
 *   20% attack surface
 *   20% freshness
 *   15% research potential
 *   10% complexity
 *   10% policy fit
 *    5% inverse duplicate risk
 */

export interface DimensionScores {
  businessValue: number;
  attackSurface: number;
  freshness: number;
  researchPotential: number;
  complexity: number;
  policyFit: number;
  duplicateRisk: number;
}

export const OPPORTUNITY_WEIGHTS = {
  businessValue: 0.2,
  attackSurface: 0.2,
  freshness: 0.2,
  researchPotential: 0.15,
  complexity: 0.1,
  policyFit: 0.1,
  inverseDuplicateRisk: 0.05,
} as const;

/** Clamps a value into 0-100 and rounds to an integer. */
export function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, Math.round(value * 100) / 100));
}

export function calculateOpportunityScore(scores: DimensionScores): number {
  const businessValue = clampScore(scores.businessValue);
  const attackSurface = clampScore(scores.attackSurface);
  const freshness = clampScore(scores.freshness);
  const researchPotential = clampScore(scores.researchPotential);
  const complexity = clampScore(scores.complexity);
  const policyFit = clampScore(scores.policyFit);
  const duplicateRisk = clampScore(scores.duplicateRisk);

  const raw =
    OPPORTUNITY_WEIGHTS.businessValue * businessValue +
    OPPORTUNITY_WEIGHTS.attackSurface * attackSurface +
    OPPORTUNITY_WEIGHTS.freshness * freshness +
    OPPORTUNITY_WEIGHTS.researchPotential * researchPotential +
    OPPORTUNITY_WEIGHTS.complexity * complexity +
    OPPORTUNITY_WEIGHTS.policyFit * policyFit +
    OPPORTUNITY_WEIGHTS.inverseDuplicateRisk * (100 - duplicateRisk);

  return clampScore(raw);
}

/**
 * Per-dimension contribution to the final score, for the UI breakdown.
 *
 * `value` is always the dimension as stored and as the model reported it —
 * duplicate risk included, where 0 means low risk and 100 means high risk. The
 * inversion happens only inside `contribution`, mirroring the formula. The UI
 * therefore shows the true duplicate-risk number and never a second inversion.
 */
export interface ScoreContribution {
  key: keyof DimensionScores;
  /** Dictionary key for the label, so the UI can localise it. */
  labelKey: string;
  value: number;
  weight: number;
  contribution: number;
  /** True when the formula uses (100 - value) rather than value. */
  inverted: boolean;
}

export function scoreContributions(scores: DimensionScores): ScoreContribution[] {
  const entries: Omit<ScoreContribution, "contribution">[] = [
    {
      key: "businessValue",
      labelKey: "score.businessValue",
      value: clampScore(scores.businessValue),
      weight: OPPORTUNITY_WEIGHTS.businessValue,
      inverted: false,
    },
    {
      key: "attackSurface",
      labelKey: "score.attackSurface",
      value: clampScore(scores.attackSurface),
      weight: OPPORTUNITY_WEIGHTS.attackSurface,
      inverted: false,
    },
    {
      key: "freshness",
      labelKey: "score.freshness",
      value: clampScore(scores.freshness),
      weight: OPPORTUNITY_WEIGHTS.freshness,
      inverted: false,
    },
    {
      key: "researchPotential",
      labelKey: "score.researchPotential",
      value: clampScore(scores.researchPotential),
      weight: OPPORTUNITY_WEIGHTS.researchPotential,
      inverted: false,
    },
    {
      key: "complexity",
      labelKey: "score.complexity",
      value: clampScore(scores.complexity),
      weight: OPPORTUNITY_WEIGHTS.complexity,
      inverted: false,
    },
    {
      key: "policyFit",
      labelKey: "score.policyFit",
      value: clampScore(scores.policyFit),
      weight: OPPORTUNITY_WEIGHTS.policyFit,
      inverted: false,
    },
    {
      key: "duplicateRisk",
      labelKey: "score.duplicateRisk",
      value: clampScore(scores.duplicateRisk),
      weight: OPPORTUNITY_WEIGHTS.inverseDuplicateRisk,
      inverted: true,
    },
  ];

  return entries.map((entry) => ({
    ...entry,
    contribution: (entry.inverted ? 100 - entry.value : entry.value) * entry.weight,
  }));
}
