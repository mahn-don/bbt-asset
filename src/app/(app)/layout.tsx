import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { getUiPreferences } from "@/lib/preferences";
import { createTranslator } from "@/lib/i18n/translator";
import { LogoutButton } from "@/components/logout-button";
import { HeaderLocaleToggle, HeaderThemeToggle } from "@/components/preference-switchers";

/**
 * Authenticated shell.
 *
 * Every page under this route group is gated here: an unauthenticated visitor
 * is redirected before any page component runs or any data is read.
 *
 * The header is split into three visually distinct zones — brand, primary
 * navigation, and user controls — separated by a divider and spacing rather
 * than being one flat row.
 */

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { locale, theme } = await getUiPreferences();
  const t = createTranslator(locale);

  const nav = [
    { href: "/", label: t.t("nav.dashboard") },
    { href: "/assets", label: t.t("nav.assets") },
    { href: "/programs", label: t.t("nav.programs") },
    { href: "/ai-supporter", label: t.t("nav.aiSupporter") },
    { href: "/changes", label: t.t("nav.changes") },
  ];

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-line bg-header-bg/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-5 gap-y-2 px-5 py-2.5">
          {/* Brand */}
          <Link href="/" className="flex shrink-0 items-center gap-2">
            <span className="rounded-md bg-accent px-1.5 py-0.5 font-mono text-xs font-bold text-accent-contrast">
              {t.t("app.brandShort")}
            </span>
            <span className="hidden text-sm font-semibold text-ink sm:inline">
              {t.t("app.name")}
            </span>
          </Link>

          <span className="hidden h-5 w-px bg-line md:block" aria-hidden="true" />

          {/* Primary navigation */}
          <nav className="flex flex-wrap items-center gap-0.5" aria-label={t.t("nav.primary")}>
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-lg px-3 py-1.5 text-[13px] font-medium text-ink-soft transition-colors hover:bg-neutral-soft hover:text-ink"
              >
                {item.label}
              </Link>
            ))}
            <Link
              href="/settings/ai"
              className="rounded-lg px-3 py-1.5 text-[13px] font-medium text-ink-soft transition-colors hover:bg-neutral-soft hover:text-ink"
            >
              {t.t("nav.settings")}
            </Link>
          </nav>

          {/* User controls */}
          <div className="ml-auto flex items-center gap-2">
            <HeaderLocaleToggle current={locale} />
            <HeaderThemeToggle current={theme} />
            <span className="hidden h-5 w-px bg-line lg:block" aria-hidden="true" />
            <span className="hidden max-w-[16ch] truncate text-xs text-ink-faint lg:inline">
              {user.email}
            </span>
            <LogoutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] px-5 py-6">{children}</main>

      <footer className="mx-auto max-w-[1600px] px-5 pb-8 pt-2">
        <p className="type-help max-w-4xl">{t.t("app.footerNote")}</p>
      </footer>
    </div>
  );
}
