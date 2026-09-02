import type { Metadata } from "next";
import "./globals.css";
import { getUiPreferences } from "@/lib/preferences";
import { THEME_INIT_SCRIPT } from "@/lib/theme/config";
import { LOCALE_TAGS } from "@/lib/i18n/config";
import { I18nProvider } from "@/components/i18n-provider";
import { ThemeSync } from "@/components/theme-sync";

export const metadata: Metadata = {
  title: "Bug Bounty Asset Intelligence",
  description:
    "Aggregate authorized bug bounty programs and scope, detect changes, and prioritise research.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { locale, theme } = await getUiPreferences();

  // An explicit light/dark choice is stamped server-side, so the first painted
  // frame is already correct. "system" is resolved by the inline script below
  // before paint. Either way there is no flash of the wrong theme.
  const serverTheme = theme === "system" ? undefined : theme;

  return (
    <html
      lang={LOCALE_TAGS[locale]}
      data-theme-preference={theme}
      {...(serverTheme ? { "data-theme": serverTheme } : {})}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-canvas text-ink antialiased">
        <ThemeSync preference={theme} />
        <I18nProvider locale={locale}>{children}</I18nProvider>
      </body>
    </html>
  );
}
