import "server-only";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { LOCALE_COOKIE, normalizeLocale, type Locale } from "@/lib/i18n/config";
import { THEME_COOKIE, normalizeTheme, type ThemePreference } from "@/lib/theme/config";
import { createTranslator, type Translator } from "@/lib/i18n/translator";
import { getCurrentUser } from "@/lib/auth/session";

/**
 * UI preference resolution.
 *
 * Two-tier storage, on purpose:
 *
 *  - A cookie is the fast path. It is readable during the very first server
 *    render, which is what lets the correct theme and language be emitted in
 *    the initial HTML with no flash and no client round-trip.
 *  - The `User` row is the durable store, so preferences follow the account to
 *    another browser. On sign-in the cookie is seeded from the row.
 *
 * The cookie wins when both exist, because it reflects the most recent
 * explicit choice on this device.
 */

export interface UiPreferences {
  locale: Locale;
  theme: ThemePreference;
}

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export async function getUiPreferences(): Promise<UiPreferences> {
  const cookieStore = await cookies();

  const cookieLocale = cookieStore.get(LOCALE_COOKIE)?.value;
  const cookieTheme = cookieStore.get(THEME_COOKIE)?.value;

  // A cookie present for both means no database read is needed at all.
  if (cookieLocale && cookieTheme) {
    return { locale: normalizeLocale(cookieLocale), theme: normalizeTheme(cookieTheme) };
  }

  let userLocale: string | undefined;
  let userTheme: string | undefined;

  const user = await getCurrentUser();
  if (user) {
    const row = await prisma.user
      .findUnique({ where: { id: user.id }, select: { locale: true, theme: true } })
      .catch(() => null);
    userLocale = row?.locale;
    userTheme = row?.theme;
  }

  return {
    locale: normalizeLocale(cookieLocale ?? userLocale),
    theme: normalizeTheme(cookieTheme ?? userTheme),
  };
}

/** Convenience: preferences plus a ready-to-use translator. */
export async function getTranslator(): Promise<Translator> {
  const { locale } = await getUiPreferences();
  return createTranslator(locale);
}

export async function getLocale(): Promise<Locale> {
  return (await getUiPreferences()).locale;
}

/**
 * Persists a preference to both the cookie and, when signed in, the user row.
 */
export async function setUiPreference(
  update: { locale?: Locale; theme?: ThemePreference },
): Promise<void> {
  const cookieStore = await cookies();

  const options = {
    httpOnly: false, // read by the pre-paint theme script; contains no secret
    sameSite: "lax" as const,
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  };

  if (update.locale) cookieStore.set(LOCALE_COOKIE, update.locale, options);
  if (update.theme) cookieStore.set(THEME_COOKIE, update.theme, options);

  const user = await getCurrentUser();
  if (!user) return;

  await prisma.user
    .update({
      where: { id: user.id },
      data: {
        ...(update.locale ? { locale: update.locale } : {}),
        ...(update.theme ? { theme: update.theme } : {}),
      },
    })
    .catch(() => undefined);
}

/** Called after sign-in so the account's stored preferences take effect. */
export async function syncPreferenceCookies(userId: string): Promise<void> {
  const row = await prisma.user
    .findUnique({ where: { id: userId }, select: { locale: true, theme: true } })
    .catch(() => null);

  if (!row) return;

  const cookieStore = await cookies();
  const options = {
    httpOnly: false,
    sameSite: "lax" as const,
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  };

  cookieStore.set(LOCALE_COOKIE, normalizeLocale(row.locale), options);
  cookieStore.set(THEME_COOKIE, normalizeTheme(row.theme), options);
}
