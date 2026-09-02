import Link from "next/link";
import { notFound } from "next/navigation";
import { getAssetDetail } from "@/lib/queries/assets";
import { authorize, authorizationStatus } from "@/lib/authorization/scope-authorization";
import { scoreContributions } from "@/lib/scoring/opportunity";
import { getUiPreferences } from "@/lib/preferences";
import { createTranslator } from "@/lib/i18n/translator";
import { renderNow } from "@/lib/render-clock";
import { LOCALE_LABELS, isLocale } from "@/lib/i18n/config";
import {
  Badge,
  Card,
  Detail,
  EmptyState,
  EvalStatusBadge,
  EvaluationSourceBadge,
  Fact,
  ImportanceBadge,
  Mono,
  Notice,
  OpportunityScore,
  PageHeader,
  RelativeTime,
  ScopeStatusBadge,
  ScoreBar,
  SeverityBadge,
  Table,
  TagList,
  Td,
  TextLink,
  Th,
  Tr,
  ValueDiff,
} from "@/components/ui";
import { ReevaluateButton } from "@/components/reevaluate-button";

export const dynamic = "force-dynamic";

function parseJsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export default async function AssetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { locale } = await getUiPreferences();
  const t = createTranslator(locale);

  const scope = await getAssetDetail(id);
  if (!scope) notFound();

  const authorization = await authorize(scope.id);
  const authStatus = authorizationStatus(authorization);
  const now = renderNow();

  // The current evaluation is the newest COMPLETED one; if none exists we show
  // the latest attempt so a PENDING/FAILED state is visible rather than blank.
  const completed = scope.aiEvaluations.find((evaluation) => evaluation.status === "COMPLETED");
  const current = completed ?? scope.aiEvaluations[0] ?? null;

  const tags = parseJsonArray(current?.tags ?? null);
  const researchAreas = parseJsonArray(current?.suggestedResearchAreas ?? null);
  const warnings = parseJsonArray(current?.warnings ?? null);

  const contributions =
    completed &&
    completed.businessValueScore !== null &&
    completed.attackSurfaceScore !== null &&
    completed.freshnessScore !== null &&
    completed.researchPotentialScore !== null &&
    completed.complexityScore !== null &&
    completed.policyFitScore !== null &&
    completed.duplicateRiskScore !== null
      ? scoreContributions({
          businessValue: completed.businessValueScore,
          attackSurface: completed.attackSurfaceScore,
          freshness: completed.freshnessScore,
          researchPotential: completed.researchPotentialScore,
          complexity: completed.complexityScore,
          policyFit: completed.policyFitScore,
          duplicateRisk: completed.duplicateRiskScore,
        })
      : null;

  const isModelEvaluation = completed?.evaluationSource === "AI_MODEL";

  // An evaluation written in another language is shown as-is with an offer to
  // re-evaluate, rather than silently re-running every historical evaluation.
  const evaluationLanguage = completed?.language ?? null;
  const languageMismatch =
    completed !== undefined && evaluationLanguage !== null && evaluationLanguage !== locale;

  const authTone =
    authStatus === "VERIFIED" ? "success" : authStatus === "USER_CONFIRMED" ? "info" : "danger";

  return (
    <>
      <PageHeader
        title={scope.assetIdentifier}
        description={`${scope.program.name} · ${scope.program.provider.slug}`}
        actions={<ReevaluateButton scopeId={scope.id} />}
      />

      {/* --- Header facts --- */}
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {/* Scope classification is what the PROVIDER says. */}
        <Fact label={t.t("asset.scopeClassification")}>
          <ScopeStatusBadge status={scope.scopeStatus} t={t} />
        </Fact>

        {/* Authorization is what OUR gate concluded. Two separate questions. */}
        <Fact label={t.t("asset.researchAuthorization")}>
          <Badge tone={authTone}>
            {authStatus === "VERIFIED"
              ? t.t("authz.verified")
              : authStatus === "USER_CONFIRMED"
                ? t.t("authz.userConfirmed")
                : t.t("authz.notVerified")}
          </Badge>
        </Fact>

        <Fact label={t.t("asset.assetType")}>
          <Badge tone="neutral">{scope.assetType}</Badge>
        </Fact>
        <Fact label={t.t("asset.bountyEligible")}>
          {scope.eligibleForBounty ? (
            <Badge tone="success">{t.t("common.yes")}</Badge>
          ) : (
            <Badge tone="neutral">{t.t("common.no")}</Badge>
          )}
        </Fact>
        <Fact label={t.t("asset.submissionEligible")}>
          {scope.eligibleForSubmission ? (
            <Badge tone="success">{t.t("common.yes")}</Badge>
          ) : (
            <Badge tone="neutral">{t.t("common.no")}</Badge>
          )}
        </Fact>
        <Fact label={t.t("asset.maxSeverity")}>
          <SeverityBadge severity={scope.maxSeverity} t={t} />
        </Fact>
      </div>

      {/* --- Authorization detail --- */}
      <div
        className={`mb-6 rounded-xl border px-4 py-3.5 ${
          authorization.decision === "ALLOW"
            ? "border-success/30 bg-success-soft"
            : "border-danger/30 bg-danger-soft"
        }`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={authTone}>
            {authStatus === "VERIFIED"
              ? t.t("authz.verified")
              : authStatus === "USER_CONFIRMED"
                ? t.t("authz.userConfirmed")
                : t.t("authz.notVerified")}
          </Badge>
          <span className="type-meta">
            {t.t("asset.verifiedAt")}{" "}
            <RelativeTime date={authorization.context.lastVerifiedAt ?? null} now={now} t={t} />
          </span>
        </div>

        {authorization.reasons.length > 0 ? (
          <ul className="mt-2 list-inside list-disc text-[13px] text-danger-ink">
            {authorization.reasons.map((reason) => (
              <li key={reason}>{t.maybe(`authz.reason.${reason}`, reason)}</li>
            ))}
          </ul>
        ) : (
          <p className="type-meta mt-2 max-w-3xl">{t.t("asset.authorizedNote")}</p>
        )}
      </div>

      <div className="grid gap-6 xl:grid-cols-[2fr_3fr]">
        {/* --- Provider data --- */}
        <div className="flex flex-col gap-6">
          <Card title={t.t("asset.providerData")}>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-4 px-4 py-4">
              <Detail label={t.t("assets.col.provider")}>{scope.program.provider.name}</Detail>
              <Detail label={t.t("assets.col.program")}>
                <TextLink href={`/assets?programId=${scope.programId}`}>
                  {scope.program.name}
                </TextLink>
              </Detail>
              <Detail label={t.t("asset.programStatus")}>
                {t.maybe(`programStatus.${scope.program.status}`, scope.program.status)}
              </Detail>
              <Detail label={t.t("asset.visibility")}>
                {t.maybe(`visibility.${scope.program.visibility}`, scope.program.visibility)}
              </Detail>
              <Detail label={t.t("asset.safeHarbor")}>
                {scope.program.safeHarbor ?? t.t("common.unknown")}
              </Detail>
              <Detail label={t.t("asset.bountyRange")}>
                {scope.program.bountyMin === null && scope.program.bountyMax === null
                  ? t.t("common.notPublished")
                  : `${t.formatCurrency(scope.program.bountyMin ?? 0, scope.program.currency)} – ${t.formatCurrency(scope.program.bountyMax ?? 0, scope.program.currency)}`}
              </Detail>
              <Detail label={t.t("asset.sourceUpdated")}>
                <RelativeTime
                  date={scope.sourceUpdatedAt}
                  fallback={t.t("common.notPublished")}
                  now={now}
                  t={t}
                />
              </Detail>
              <Detail label={t.t("asset.firstSeen")}>
                <RelativeTime date={scope.firstSeenAt} now={now} t={t} />
              </Detail>
              <Detail label={t.t("asset.lastSeen")}>
                <RelativeTime date={scope.lastSeenAt} now={now} t={t} />
              </Detail>
              <Detail label={t.t("asset.lastSync")}>
                <RelativeTime date={scope.program.lastSyncedAt} now={now} t={t} />
              </Detail>
              <Detail label={t.t("asset.provenance")}>
                <Badge tone={scope.program.provider.slug === "MANUAL" ? "warning" : "neutral"}>
                  {scope.program.provider.slug === "MANUAL"
                    ? t.t("asset.provenanceManual")
                    : t.t("asset.provenanceProvider")}
                </Badge>
              </Detail>
              <Detail label={t.t("common.version")}>v{scope.version}</Detail>
            </dl>

            {scope.program.sourceUrl ? (
              <div className="border-t border-line px-4 py-3">
                <TextLink href={scope.program.sourceUrl} external>
                  {t.t("asset.openOnProvider", { provider: scope.program.provider.name })}
                </TextLink>
              </div>
            ) : null}
          </Card>

          <Card title={t.t("asset.scopeInstructions")}>
            {scope.instruction ? (
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap px-4 py-3.5 font-mono text-[13px] leading-relaxed text-ink-soft">
                {scope.instruction}
              </pre>
            ) : (
              <EmptyState title={t.t("asset.noInstructions")} />
            )}
          </Card>
        </div>

        {/* --- AI panel --- */}
        <div className="flex flex-col gap-6">
          <Card
            title={t.t("ai.evaluation")}
            actions={current ? <EvalStatusBadge status={current.status} t={t} /> : undefined}
          >
            {!completed ? (
              <EmptyState
                title={
                  current?.status === "FAILED"
                    ? t.t("ai.lastFailed")
                    : current
                      ? t.t("ai.queued")
                      : t.t("ai.notEvaluated")
                }
                description={current?.errorSummary ?? t.t("ai.evaluateHelp")}
              />
            ) : (
              <div className="px-4 py-4">
                {/* Provenance first: model vs rule engine must be unmissable. */}
                <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-lg border border-line bg-sunken px-3.5 py-3">
                  <div>
                    <p className="type-label">{t.t("ai.evaluationSource")}</p>
                    <div className="mt-1">
                      <EvaluationSourceBadge
                        source={completed.evaluationSource ?? "HEURISTIC"}
                        t={t}
                      />
                    </div>
                  </div>
                  <div>
                    <p className="type-label">{t.t("ai.provider")}</p>
                    <p className="mt-1 text-[13px] text-ink">
                      {isModelEvaluation ? completed.aiProvider : t.t("ai.offlineRuleEngine")}
                    </p>
                  </div>
                  {isModelEvaluation ? (
                    <div>
                      <p className="type-label">{t.t("ai.model")}</p>
                      <Mono className="mt-1 block text-[13px] text-ink">{completed.model}</Mono>
                    </div>
                  ) : null}
                </div>

                <div className="mb-4 flex flex-wrap items-center gap-5">
                  <OpportunityScore score={completed.opportunityScore} size="lg" t={t} />
                  <div className="type-meta">
                    <p>
                      {t.t("ai.confidence")}:{" "}
                      <Mono className="text-ink">
                        {completed.confidence !== null ? completed.confidence.toFixed(2) : "—"}
                      </Mono>
                    </p>
                    <p>
                      {t.t("ai.evaluatedAt")}{" "}
                      <RelativeTime date={completed.evaluatedAt} now={now} t={t} />
                    </p>
                  </div>
                </div>

                {languageMismatch ? (
                  <div className="mb-4">
                    <Notice tone="info">
                      {t.t("ai.writtenInOtherLanguage", {
                        language: isLocale(evaluationLanguage)
                          ? LOCALE_LABELS[evaluationLanguage]
                          : (evaluationLanguage ?? ""),
                      })}
                    </Notice>
                  </div>
                ) : null}

                {completed.summary ? (
                  <p className="mb-4 text-sm leading-relaxed text-ink">{completed.summary}</p>
                ) : null}

                {completed.reasoningSummary ? (
                  <div className="mb-5">
                    <h3 className="type-label mb-1.5">{t.t("ai.whyInteresting")}</h3>
                    <p className="type-meta">{completed.reasoningSummary}</p>
                  </div>
                ) : null}

                {contributions ? (
                  <div className="mb-5">
                    <h3 className="type-label mb-2.5">{t.t("ai.dimensionScores")}</h3>
                    <div className="flex flex-col gap-2">
                      {contributions.map((entry) => (
                        <ScoreBar
                          key={entry.key}
                          // Duplicate Risk shows its true value (0 = low risk).
                          // Only the formula inverts it; the label never says so.
                          label={t.maybe(entry.labelKey, entry.key)}
                          value={entry.value}
                          weight={entry.weight}
                          help={
                            entry.key === "duplicateRisk"
                              ? t.t("score.duplicateRiskHelp")
                              : undefined
                          }
                        />
                      ))}
                    </div>
                    <p className="type-help mt-2.5">{t.t("ai.scoreNote")}</p>
                  </div>
                ) : null}

                {tags.length > 0 ? (
                  <div className="mb-4">
                    <h3 className="type-label mb-1.5">{t.t("ai.tags")}</h3>
                    <TagList tags={tags} max={20} />
                  </div>
                ) : null}

                {researchAreas.length > 0 ? (
                  <div className="mb-4">
                    <h3 className="type-label mb-1.5">{t.t("ai.suggestedResearch")}</h3>
                    <ul className="list-inside list-disc text-[13px] text-ink-soft">
                      {researchAreas.map((area) => (
                        <li key={area}>{area}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {warnings.length > 0 ? (
                  <div className="rounded-lg border border-warning/30 bg-warning-soft px-3.5 py-3">
                    <h3 className="type-label mb-1.5 text-warning-ink">{t.t("ai.warnings")}</h3>
                    <ul className="list-inside list-disc text-[13px] text-warning-ink">
                      {warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            )}
          </Card>

          {/* --- Change history --- */}
          <Card
            title={t.t("history.change")}
            subtitle={t.t("history.changesRecorded", { count: scope.changeEvents.length })}
          >
            {scope.changeEvents.length === 0 ? (
              <EmptyState title={t.t("history.noChanges")} />
            ) : (
              <ul className="divide-y divide-line/60">
                {scope.changeEvents.map((change) => (
                  <li key={change.id} className="px-4 py-3.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="neutral">
                        {t.maybe(
                          `changeType.${change.changeType}`,
                          change.changeType.replace(/_/g, " "),
                        )}
                      </Badge>
                      <ImportanceBadge importance={change.importance} t={t} />
                      {change.fieldName ? (
                        <Mono className="text-xs text-ink-soft">{change.fieldName}</Mono>
                      ) : null}
                      <span className="ml-auto text-xs text-ink-faint">
                        <RelativeTime date={change.detectedAt} now={now} t={t} />
                      </span>
                    </div>

                    {change.oldValue !== null || change.newValue !== null ? (
                      <div className="mt-2.5">
                        <ValueDiff before={change.oldValue} after={change.newValue} t={t} />
                      </div>
                    ) : null}

                    {change.aiSummary ? (
                      <p className="type-meta mt-2">{change.aiSummary}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* --- Scope version history --- */}
          <Card
            title={t.t("history.scope")}
            subtitle={t.t("history.versions", { count: scope.versions.length })}
          >
            {scope.versions.length === 0 ? (
              <EmptyState title={t.t("history.noVersions")} />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th className="w-16">{t.t("common.version")}</Th>
                    <Th>{t.t("history.validFrom")}</Th>
                    <Th>{t.t("history.validTo")}</Th>
                    <Th>{t.t("history.contentHash")}</Th>
                  </tr>
                </thead>
                <tbody>
                  {scope.versions.map((version) => (
                    <Tr key={version.id}>
                      <Td>
                        <Mono className="font-medium text-ink">v{version.version}</Mono>
                      </Td>
                      <Td className="text-ink-soft">
                        <RelativeTime date={version.validFrom} now={now} t={t} />
                      </Td>
                      <Td className="text-ink-soft">
                        {version.validTo ? (
                          <RelativeTime date={version.validTo} now={now} t={t} />
                        ) : (
                          <Badge tone="success">{t.t("history.current")}</Badge>
                        )}
                      </Td>
                      <Td>
                        <Mono className="text-xs text-ink-faint">
                          {version.contentHash.slice(0, 12)}
                        </Mono>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          {/* --- AI evaluation history --- */}
          <Card title={t.t("ai.evaluationHistory")}>
            {scope.aiEvaluations.length === 0 ? (
              <EmptyState title={t.t("ai.noEvaluations")} />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>{t.t("assets.col.status")}</Th>
                    <Th>{t.t("ai.evaluationSource")}</Th>
                    <Th align="right">{t.t("assets.col.score")}</Th>
                    <Th align="right">{t.t("ai.confidence")}</Th>
                    <Th>{t.t("nav.language")}</Th>
                    <Th>{t.t("ai.provider")}</Th>
                    <Th>{t.t("assets.col.lastChanged")}</Th>
                  </tr>
                </thead>
                <tbody>
                  {scope.aiEvaluations.map((evaluation) => (
                    <Tr key={evaluation.id}>
                      <Td>
                        <EvalStatusBadge status={evaluation.status} t={t} />
                      </Td>
                      <Td>
                        <EvaluationSourceBadge
                          source={evaluation.evaluationSource ?? "HEURISTIC"}
                          t={t}
                        />
                      </Td>
                      <Td align="right">
                        <Mono className="font-medium text-ink">
                          {evaluation.opportunityScore ?? "—"}
                        </Mono>
                      </Td>
                      <Td align="right">
                        <Mono className="text-ink-soft">
                          {evaluation.confidence !== null ? evaluation.confidence.toFixed(2) : "—"}
                        </Mono>
                      </Td>
                      <Td className="text-ink-soft">
                        {isLocale(evaluation.language)
                          ? LOCALE_LABELS[evaluation.language]
                          : evaluation.language}
                      </Td>
                      <Td className="text-ink-soft">{evaluation.aiProvider}</Td>
                      <Td className="text-ink-soft">
                        <RelativeTime date={evaluation.createdAt} now={now} t={t} />
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

export { Link };
