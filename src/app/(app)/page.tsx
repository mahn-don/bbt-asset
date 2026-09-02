import Link from "next/link";
import { getDashboardMetrics, getRecentChanges, getTopOpportunities } from "@/lib/queries/dashboard";
import { queueDepth } from "@/lib/jobs/queue";
import { getUiPreferences } from "@/lib/preferences";
import { createTranslator } from "@/lib/i18n/translator";
import { renderNow } from "@/lib/render-clock";
import {
  Badge,
  Card,
  EmptyState,
  ImportanceBadge,
  MetricCard,
  Mono,
  OpportunityScore,
  PageHeader,
  RelativeTime,
  TagList,
  TextLink,
} from "@/components/ui";
import { DrainQueueButton } from "@/components/drain-queue-button";

export const dynamic = "force-dynamic";

/**
 * Dashboard.
 *
 * Every figure is a real aggregate. Cards for features with no data yet
 * (findings, payouts) are omitted rather than shown as zero.
 */
export default async function DashboardPage() {
  const { locale } = await getUiPreferences();
  const t = createTranslator(locale);

  const [metrics, opportunities, changes, queue] = await Promise.all([
    getDashboardMetrics(),
    getTopOpportunities(10),
    getRecentChanges(12),
    queueDepth(),
  ]);

  // One reference instant, so every relative timestamp on the page agrees.
  const now = renderNow();

  return (
    <>
      <PageHeader
        title={t.t("dashboard.title")}
        description={t.t("dashboard.description")}
        actions={queue.pending > 0 ? <DrainQueueButton pending={queue.pending} /> : undefined}
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <MetricCard label={t.t("metric.programs")} value={metrics.programs} href="/programs" />
        <MetricCard label={t.t("metric.activeScopes")} value={metrics.activeScopes} href="/assets" />
        <MetricCard
          label={t.t("metric.newAssets")}
          value={metrics.newAssets7d}
          hint={t.t("metric.newAssetsHint")}
          href="/assets?isNew=true&sort=newest"
        />
        <MetricCard
          label={t.t("metric.changesToday")}
          value={metrics.changesToday}
          href="/changes"
        />
        <MetricCard
          label={t.t("metric.highOpportunity")}
          value={metrics.highOpportunityAssets}
          hint={t.t("metric.highOpportunityHint")}
          href="/assets?minScore=80"
        />
        <MetricCard
          label={t.t("metric.pendingAi")}
          value={metrics.pendingAiEvaluations}
          hint={
            queue.failed > 0
              ? t.t("metric.failedJobs", { count: queue.failed })
              : t.t("metric.pendingAiHint")
          }
        />

        {/* Only rendered once these features actually hold data. */}
        {metrics.findings.available ? (
          <MetricCard label={t.t("metric.findings")} value={metrics.findings.count} />
        ) : null}
        {metrics.totalPayout.available ? (
          <MetricCard
            label={t.t("metric.totalPayout")}
            value={t.formatCurrency(metrics.totalPayout.amount, metrics.totalPayout.currency)}
          />
        ) : null}
      </div>

      <div className="grid gap-6 xl:grid-cols-[3fr_2fr]">
        <Card
          title={t.t("dashboard.opportunities")}
          subtitle={t.t("dashboard.opportunitiesSubtitle")}
          actions={<TextLink href="/assets">{t.t("dashboard.allAssets")}</TextLink>}
        >
          {opportunities.length === 0 ? (
            <EmptyState
              title={t.t("dashboard.noOpportunities")}
              description={t.t("dashboard.noOpportunitiesHelp")}
            />
          ) : (
            <ul className="divide-y divide-line/60">
              {opportunities.map((item) => (
                <li key={item.scopeId} className="flex gap-4 px-4 py-3.5">
                  <div className="w-16 shrink-0">
                    <OpportunityScore score={item.opportunityScore} t={t} />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <Link
                        href={`/assets/${item.scopeId}`}
                        className="min-w-0 break-all font-mono text-sm font-medium text-ink hover:text-accent"
                      >
                        {item.assetIdentifier}
                      </Link>
                      <Badge tone="neutral">{item.assetType}</Badge>
                      {item.isNew ? <Badge tone="accent">{t.t("badge.new")}</Badge> : null}
                      {item.isChanged ? <Badge tone="info">{t.t("badge.changed")}</Badge> : null}
                      {item.eligibleForBounty ? (
                        <Badge tone="success">{t.t("assets.col.bounty")}</Badge>
                      ) : null}
                    </div>

                    <p className="type-meta mt-1">
                      {item.programName}
                      <span className="text-ink-faint"> · {item.provider}</span>
                      {item.lastChangedAt ? (
                        <>
                          {" · "}
                          <RelativeTime date={item.lastChangedAt} now={now} t={t} />
                        </>
                      ) : null}
                      {item.confidence !== null ? (
                        <span className="text-ink-faint">
                          {" · "}
                          {t.t("ai.confidence")} {item.confidence.toFixed(2)}
                        </span>
                      ) : null}
                    </p>

                    {item.summary ? (
                      <p className="type-meta mt-1.5 line-clamp-2">{item.summary}</p>
                    ) : null}

                    <div className="mt-2">
                      <TagList tags={item.tags} />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title={t.t("dashboard.recentChanges")}
          actions={<TextLink href="/changes">{t.t("dashboard.allChanges")}</TextLink>}
        >
          {changes.length === 0 ? (
            <EmptyState
              title={t.t("dashboard.noChanges")}
              description={t.t("dashboard.noChangesHelp")}
            />
          ) : (
            <ul className="divide-y divide-line/60">
              {changes.map((change) => (
                <li key={change.id} className="px-4 py-3">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <Badge tone="neutral">
                      {t.maybe(
                        `changeType.${change.changeType}`,
                        change.changeType.replace(/_/g, " "),
                      )}
                    </Badge>
                    <ImportanceBadge importance={change.importance} t={t} />
                    <span className="ml-auto text-xs text-ink-faint">
                      <RelativeTime date={change.detectedAt} now={now} t={t} />
                    </span>
                  </div>

                  <p className="mt-1.5 text-[13px]">
                    {change.scope ? (
                      <Link
                        href={`/assets/${change.scope.id}`}
                        className="font-mono font-medium text-ink hover:text-accent"
                      >
                        {change.scope.assetIdentifier}
                      </Link>
                    ) : (
                      <Mono className="text-ink-soft">
                        {change.program?.name ?? change.provider.slug}
                      </Mono>
                    )}
                    <span className="text-ink-faint">
                      {" · "}
                      {change.program?.name ?? change.provider.slug}
                    </span>
                  </p>

                  {change.aiSummary ? (
                    <p className="type-help mt-1 line-clamp-2">{change.aiSummary}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
