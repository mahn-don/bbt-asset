import { notFound } from "next/navigation";
import { listSyncRuns } from "@/lib/queries/integrations";
import { isProviderSlug } from "@/lib/enums";
import { getUiPreferences } from "@/lib/preferences";
import { createTranslator } from "@/lib/i18n/translator";
import { renderNow } from "@/lib/render-clock";
import {
  Card,
  EmptyState,
  LinkButton,
  Mono,
  PageHeader,
  RelativeTime,
  SyncStatusBadge,
  Table,
  Td,
  Th,
  Tr,
} from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function SyncHistoryPage({
  params,
}: {
  params: Promise<{ provider: string }>;
}) {
  const { provider } = await params;
  const slug = provider.toUpperCase();

  if (!isProviderSlug(slug)) notFound();

  const { locale } = await getUiPreferences();
  const t = createTranslator(locale);
  const now = renderNow();

  const runs = await listSyncRuns(slug, 50);

  return (
    <>
      <PageHeader
        title={t.t("syncHistory.title", { provider: slug })}
        description={t.t("syncHistory.description")}
        actions={
          <LinkButton href="/settings/integrations" variant="secondary">
            {t.t("syncHistory.back")}
          </LinkButton>
        }
      />

      <Card title={t.plural("syncHistory.runs", runs.length)}>
        {runs.length === 0 ? (
          <EmptyState title={t.t("syncHistory.empty")} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t.t("syncHistory.col.status")}</Th>
                <Th>{t.t("syncHistory.col.trigger")}</Th>
                <Th>{t.t("syncHistory.col.started")}</Th>
                <Th align="right">{t.t("syncHistory.col.duration")}</Th>
                <Th align="right">{t.t("integrations.programs")}</Th>
                <Th align="right">{t.t("programs.col.scopes")}</Th>
                <Th align="right">{t.t("syncHistory.col.created")}</Th>
                <Th align="right">{t.t("syncHistory.col.updated")}</Th>
                <Th align="right">{t.t("syncHistory.col.removed")}</Th>
                <Th align="right">{t.t("syncHistory.col.changes")}</Th>
                <Th align="right">{t.t("syncHistory.col.aiJobs")}</Th>
                <Th align="right">{t.t("syncHistory.col.rateLimits")}</Th>
                <Th align="right">{t.t("syncHistory.col.retries")}</Th>
                <Th>{t.t("syncHistory.col.error")}</Th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <Tr key={run.id}>
                  <Td>
                    <SyncStatusBadge status={run.status} t={t} />
                  </Td>
                  <Td className="text-ink-soft">{run.triggerType}</Td>
                  <Td className="text-ink-soft">
                    <RelativeTime date={run.startedAt} now={now} t={t} />
                  </Td>
                  <Td align="right" className="text-ink-soft">
                    {run.finishedAt ? (
                      <Mono>
                        {Math.max(
                          0,
                          Math.round((run.finishedAt.getTime() - run.startedAt.getTime()) / 100) / 10,
                        )}
                        s
                      </Mono>
                    ) : (
                      "—"
                    )}
                  </Td>
                  <Td align="right"><Mono className="text-ink">{run.programsReceived}</Mono></Td>
                  <Td align="right"><Mono className="text-ink">{run.scopesReceived}</Mono></Td>
                  <Td align="right"><Mono className="text-ink-soft">{run.scopesCreated}</Mono></Td>
                  <Td align="right"><Mono className="text-ink-soft">{run.scopesUpdated}</Mono></Td>
                  <Td align="right"><Mono className="text-ink-soft">{run.scopesRemoved}</Mono></Td>
                  <Td align="right"><Mono className="text-ink">{run.changesDetected}</Mono></Td>
                  <Td align="right"><Mono className="text-ink-soft">{run.aiJobsEnqueued}</Mono></Td>
                  <Td align="right"><Mono className="text-ink-soft">{run.rateLimitCount}</Mono></Td>
                  <Td align="right"><Mono className="text-ink-soft">{run.retryCount}</Mono></Td>
                  <Td className="max-w-xs text-[13px] text-danger-ink">{run.errorSummary ?? ""}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
