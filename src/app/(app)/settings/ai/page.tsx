import { getUiPreferences } from "@/lib/preferences";
import { createTranslator } from "@/lib/i18n/translator";
import { MODEL_CATALOGUE, getAiSettings } from "@/lib/ai/settings";
import { AiSettingsForm } from "@/components/ai-settings-form";

export const dynamic = "force-dynamic";

/**
 * Settings -> AI.
 *
 * `getAiSettings()` returns the redacted record: it contains `hasApiKey` and a
 * masked hint, and no field anywhere in its type carries the plaintext key, so
 * nothing secret can reach this page's props.
 */
export default async function AiSettingsPage() {
  const { locale } = await getUiPreferences();
  const t = createTranslator(locale);

  const settings = await getAiSettings();

  return (
    <div className="max-w-4xl">
      <div className="mb-5">
        <h2 className="type-section-title">{t.t("aiSettings.title")}</h2>
        <p className="type-meta mt-1">{t.t("aiSettings.description")}</p>
      </div>

      <AiSettingsForm initial={settings} catalogue={MODEL_CATALOGUE} />
    </div>
  );
}
