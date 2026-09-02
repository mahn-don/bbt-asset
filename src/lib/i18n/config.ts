/**
 * Internationalisation configuration.
 *
 * Deliberately dependency-free: the application is server-rendered, the string
 * set is bounded, and a full i18n runtime would add more weight than it earns.
 * Dictionaries are plain typed objects; `en` is the source of truth and every
 * other locale is type-checked against it, so a missing Vietnamese key is a
 * compile error rather than a blank label in production.
 */

export const LOCALES = ["en", "vi"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  vi: "Tiếng Việt",
};

/** Short label for the compact header switcher. */
export const LOCALE_SHORT: Record<Locale, string> = {
  en: "EN",
  vi: "VI",
};

/** BCP-47 tags used for Intl date/number formatting. */
export const LOCALE_TAGS: Record<Locale, string> = {
  en: "en-US",
  vi: "vi-VN",
};

export const LOCALE_COOKIE = "bbi_locale";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

export function normalizeLocale(value: unknown): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}
