import { getUiPreferences } from "@/lib/preferences";
import { createTranslator } from "@/lib/i18n/translator";
import { SettingsNav } from "@/components/settings-nav";
import { PageHeader } from "@/components/ui";

/**
 * Settings shell.
 *
 * Grouped navigation (General / Intelligence / Integrations) rather than one
 * large integrations page. The sidebar collapses to a horizontal scroller on
 * narrow screens.
 */
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const { locale } = await getUiPreferences();
  const t = createTranslator(locale);

  const groups = [
    {
      label: t.t("settings.groupGeneral"),
      items: [
        { href: "/settings/appearance", label: t.t("settings.appearance") },
        { href: "/settings/language", label: t.t("settings.language") },
      ],
    },
    {
      label: t.t("settings.groupIntelligence"),
      items: [{ href: "/settings/ai", label: t.t("settings.ai") }],
    },
    {
      label: t.t("settings.groupIntegrations"),
      items: [{ href: "/settings/integrations", label: t.t("settings.integrations") }],
    },
  ];

  return (
    <>
      <PageHeader title={t.t("settings.title")} />

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <SettingsNav groups={groups} label={t.t("settings.nav")} />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </>
  );
}
