import Link from "next/link";
import { getFunnelStats, getRecommendations } from "@/lib/queries/ai-supporter";
import { getAiSettings } from "@/lib/ai/settings";
import { isModelBacked } from "@/lib/ai/provider";
import { getUiPreferences } from "@/lib/preferences";
import { createTranslator } from "@/lib/i18n/translator";
import {
  Badge,
  Card,
  EmptyState,
  EvaluationSourceBadge,
  LinkButton,
  MetricCard,
  Notice,
  OpportunityScore,
  PageHeader,
  SeverityBadge,
  TagList,
} from "@/components/ui";
import { GenerateRecommendations } from "@/components/generate-recommendations";

export const dynamic = "force-dynamic";

/**
 * AI Supporter.
 *
 * The narrow tip of the prioritisation funnel: deterministic filters (shown as
 * the funnel row) reduce the whole inventory to eligible scope for free, and
 * the model ranks and explains a bounded, high-value slice of it. This is where
 * AI-supported recommendations live.
 */
export default async function AiSupporterPage() {
  const { locale } = await getUiPreferences();
  const t = createTranslator(locale);

  const [funnel, recommendations, ai, modelBacked] = await Promise.all([
    getFunnelStats(),
    getRecommendations({ limit: 30 }),
    getAiSettings(),
    isModelBacked(),
  ]);

  const format = (n: number) => t.formatNumber(n);

  return (
    <>
      <PageHeader title={t.t("aiSupporter.title")} description={t.t("aiSupporter.description")} />

      {/* Provenance: recommendations are only "AI" when a model actually backs them. */}
      <div className="mb-6">
        {modelBacked ? (
          <Notice tone="info">{t.t("aiSupporter.sourceModel", { model: ai.model ?? "AI" })}</Notice>
        ) : (
          <Notice tone="warning">{t.t("aiSupporter.sourceHeuristic")}</Notice>
        )}
      </div>

      {/* The deterministic funnel — every number is a free count. */}
      <Card title={t.t("aiSupporter.funnel")} subtitle={t.t("aiSupporter.funnelNote")}>
        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          <MetricCard label={t.t("aiSupporter.allScopes")} value={format(funnel.total)} />
          <MetricCard label={t.t("aiSupporter.inScope")} value={format(funnel.inScope)} />
          <MetricCard
            label={t.t("aiSupporter.eligible")}
            value={format(funnel.eligible)}
            hint={t.t("aiSupporter.eligibleHint")}
          />
          <MetricCard label={t.t("aiSupporter.highSeverity")} value={format(funnel.highSeverity)} />
          <MetricCard label={t.t("aiSupporter.evaluated")} value={format(funnel.evaluated)} />
          <MetricCard
            label={t.t("aiSupporter.recommended")}
            value={format(funnel.recommended)}
            hint={t.t("aiSupporter.recommendedHint")}
          />
          <MetricCard
            label={t.t("aiSupporter.candidatePool")}
            value={format(funnel.candidatePool)}
          />
        </div>
      </Card>

      {/* Generate a bounded batch of recommendations on demand. */}
      <div className="mt-6">
        <Card title={t.t("aiSupporter.recommendations")}>
          <div className="border-b border-line px-4 py-4">
            <GenerateRecommendations />
          </div>

          {recommendations.length === 0 ? (
            <EmptyState
              title={t.t("aiSupporter.empty")}
              description={t.t("aiSupporter.emptyHelp")}
            />
          ) : (
            <ul className="divide-y divide-line/60">
              {recommendations.map((rec, index) => (
                <li key={rec.scopeId} className="flex gap-4 px-4 py-3.5">
                  <div className="w-8 shrink-0 pt-1 text-right font-mono text-sm text-ink-faint">
                    {index + 1}
                  </div>
                  <div className="w-16 shrink-0">
                    <OpportunityScore score={rec.opportunityScore} t={t} />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <Link
                        href={`/assets/${rec.scopeId}`}
                        className="min-w-0 break-all font-mono text-sm font-medium text-ink hover:text-accent"
                      >
                        {rec.assetIdentifier}
                      </Link>
                      <Badge tone="neutral">{rec.assetType}</Badge>
                      <EvaluationSourceBadge source={rec.evaluationSource} t={t} />
                      {rec.eligibleForBounty ? (
                        <Badge tone="success">{t.t("assets.col.bounty")}</Badge>
                      ) : null}
                      <SeverityBadge severity={rec.maxSeverity} t={t} />
                    </div>

                    <p className="type-meta mt-1">
                      {rec.programName}
                      <span className="text-ink-faint"> · {rec.provider}</span>
                      {rec.confidence !== null ? (
                        <span className="text-ink-faint">
                          {" · "}
                          {t.t("ai.confidence")} {rec.confidence.toFixed(2)}
                        </span>
                      ) : null}
                    </p>

                    {rec.summary ? (
                      <p className="type-meta mt-1.5 line-clamp-2">{rec.summary}</p>
                    ) : null}

                    <div className="mt-2">
                      <TagList tags={rec.tags} />
                    </div>
                  </div>

                  <div className="shrink-0 self-center">
                    <LinkButton href={`/assets/${rec.scopeId}`} variant="secondary">
                      {t.t("aiSupporter.open")}
                    </LinkButton>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {recommendations.length > 0 ? (
            <div className="border-t border-line px-4 py-3 text-right">
              <Link
                href="/assets?minScore=70&sort=opportunity"
                className="text-[13px] font-medium text-accent underline underline-offset-2"
              >
                {t.t("aiSupporter.viewInAssets")}
              </Link>
            </div>
          ) : null}
        </Card>
      </div>
    </>
  );
}
