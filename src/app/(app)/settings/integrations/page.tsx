import { listIntegrationSummaries } from "@/lib/queries/integrations";
import { getAiSettings } from "@/lib/ai/settings";
import { getUiPreferences } from "@/lib/preferences";
import { createTranslator } from "@/lib/i18n/translator";
import { Badge, Card, Detail, LinkButton } from "@/components/ui";
import { IntegrationCard } from "@/components/integration-card";

export const dynamic = "force-dynamic";

/**
 * Settings -> API Integrations.
 *
 * Credentials are write-only from here: the page renders masked hints returned
 * by the server, and no endpoint can return stored secret material.
 */
export default async function IntegrationsPage() {
  const { locale } = await getUiPreferences();
  const t = createTranslator(locale);

  const [integrations, ai] = await Promise.all([listIntegrationSummaries(), getAiSettings()]);

  // A model only counts as active when a key is actually stored for it.
  const modelBacked = ai.provider !== "HEURISTIC" && ai.hasApiKey;

  return (
    <div>
      <div className="mb-5">
        <h2 className="type-section-title">{t.t("integrations.title")}</h2>
        <p className="type-meta mt-1 max-w-3xl">{t.t("integrations.description")}</p>
      </div>

      {/* AI Intelligence summary — replaces the old inline provider text. */}
      <div className="mb-6">
        <Card title={t.t("aiSummary.title")}>
          <div className="flex flex-wrap items-end justify-between gap-4 px-4 py-4">
            <dl className="grid flex-1 grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
              <Detail label={t.t("ai.provider")}>
                {modelBacked ? ai.provider : t.t("aiSummary.heuristicProvider")}
              </Detail>

              {modelBacked ? (
                <Detail label={t.t("ai.model")}>
                  <span className="font-mono">{ai.model ?? "—"}</span>
                </Detail>
              ) : null}

              <Detail label={t.t("aiSettings.status")}>
                {modelBacked ? (
                  <Badge
                    tone={ai.connectionStatus === "CONNECTED" ? "success" : "neutral"}
                  >
                    {t.maybe(`connection.${ai.connectionStatus}`, ai.connectionStatus)}
                  </Badge>
                ) : (
                  <Badge tone="warning">{t.t("aiSummary.noKeyStatus")}</Badge>
                )}
              </Detail>

              <Detail label={t.t("aiSettings.scopeEvaluation")}>
                {ai.scopeEvaluationEnabled ? t.t("common.enabled") : t.t("common.disabled")}
              </Detail>

              <Detail label={t.t("aiSettings.changeAnalysis")}>
                {ai.changeAnalysisEnabled ? t.t("common.enabled") : t.t("common.disabled")}
              </Detail>
            </dl>

            <LinkButton href="/settings/ai" variant={modelBacked ? "secondary" : "primary"}>
              {modelBacked ? t.t("aiSummary.manage") : t.t("aiSummary.configure")}
            </LinkButton>
          </div>
        </Card>
      </div>

      <div className="flex flex-col gap-4">
        {integrations.map((integration) => (
          <IntegrationCard key={integration.providerSlug} integration={integration} />
        ))}
      </div>
    </div>
  );
}
