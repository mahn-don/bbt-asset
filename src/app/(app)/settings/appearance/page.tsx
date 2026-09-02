import { getUiPreferences } from "@/lib/preferences";
import { createTranslator } from "@/lib/i18n/translator";
import { Card } from "@/components/ui";
import { ThemePicker } from "@/components/preference-switchers";

export const dynamic = "force-dynamic";

export default async function AppearanceSettingsPage() {
  const { locale, theme } = await getUiPreferences();
  const t = createTranslator(locale);

  return (
    <div className="max-w-3xl">
      <div className="mb-5">
        <h2 className="type-section-title">{t.t("appearance.title")}</h2>
        <p className="type-meta mt-1">{t.t("appearance.description")}</p>
      </div>

      <Card>
        <div className="px-4 py-4">
          <ThemePicker current={theme} />
        </div>
      </Card>
    </div>
  );
}
