import { getUiPreferences } from "@/lib/preferences";
import { createTranslator } from "@/lib/i18n/translator";
import { Card } from "@/components/ui";
import { LanguagePicker } from "@/components/preference-switchers";

export const dynamic = "force-dynamic";

export default async function LanguageSettingsPage() {
  const { locale } = await getUiPreferences();
  const t = createTranslator(locale);

  return (
    <div className="max-w-3xl">
      <div className="mb-5">
        <h2 className="type-section-title">{t.t("language.title")}</h2>
        <p className="type-meta mt-1">{t.t("language.description")}</p>
      </div>

      <Card>
        <div className="px-4 py-4">
          <LanguagePicker current={locale} />
          <p className="type-help mt-5 max-w-2xl border-t border-line pt-4">
            {t.t("language.aiNote")}
          </p>
        </div>
      </Card>
    </div>
  );
}
