import { en, type MessageKey, type Messages } from "./dictionaries/en";
import { vi } from "./dictionaries/vi";
import { DEFAULT_LOCALE, LOCALE_TAGS, type Locale } from "./config";

/**
 * The translator.
 *
 * Isomorphic and dependency-free: the same `Translator` object is built on the
 * server and handed to client components, so both render identical strings.
 *
 * Date, number and currency formatting all go through `Intl` rather than
 * hand-rolled logic.
 */

export const DICTIONARIES: Record<Locale, Messages> = { en, vi };

export type TranslationParams = Record<string, string | number>;

export interface Translator {
  locale: Locale;
  /** Translate a key, interpolating `{placeholders}`. */
  t: (key: MessageKey, params?: TranslationParams) => string;
  /** Translate with English pluralisation (`key` / `key_plural`). */
  plural: (key: MessageKey, count: number, params?: TranslationParams) => string;
  /** Translate a key that may not exist, returning `fallback` when missing. */
  maybe: (key: string, fallback: string, params?: TranslationParams) => string;
  formatDate: (value: Date | string, options?: Intl.DateTimeFormatOptions) => string;
  formatRelative: (value: Date | string, now?: number) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  formatCurrency: (value: number, currency: string | null | undefined) => string;
}

function interpolate(template: string, params?: TranslationParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}

export function createTranslator(locale: Locale): Translator {
  const dictionary = DICTIONARIES[locale] ?? DICTIONARIES[DEFAULT_LOCALE];
  const fallback = DICTIONARIES[DEFAULT_LOCALE];
  const tag = LOCALE_TAGS[locale] ?? LOCALE_TAGS[DEFAULT_LOCALE];

  const translate = (key: MessageKey, params?: TranslationParams): string => {
    // Fall back to English before falling back to the raw key, so a locale
    // that is missing a string degrades to readable text rather than an id.
    const template = dictionary[key] ?? fallback[key] ?? key;
    return interpolate(template, params);
  };

  return {
    locale,

    t: translate,

    plural: (key, count, params) => {
      // Vietnamese has no plural inflection, so the singular form is correct
      // for every count; English uses the `_plural` variant above one.
      const pluralKey = `${key}_plural` as MessageKey;
      const useplural = locale === "en" && count !== 1 && pluralKey in dictionary;
      return translate(useplural ? pluralKey : key, { count, ...params });
    },

    maybe: (key, fallbackText, params) => {
      const template = (dictionary as Record<string, string>)[key] ?? fallbackText;
      return interpolate(template, params);
    },

    formatDate: (value, options) => {
      const date = typeof value === "string" ? new Date(value) : value;
      if (Number.isNaN(date.getTime())) return "";
      return new Intl.DateTimeFormat(
        tag,
        options ?? { dateStyle: "medium", timeStyle: "short" },
      ).format(date);
    },

    /**
     * Compact relative time ("9 phút trước" / "9m ago").
     *
     * Uses the dictionary rather than `Intl.RelativeTimeFormat` so the English
     * form stays in the terse `9m ago` style the tables are designed around,
     * while Vietnamese reads naturally.
     */
    formatRelative: (value, now = Date.now()) => {
      const date = typeof value === "string" ? new Date(value) : value;
      if (Number.isNaN(date.getTime())) return "";

      const minutes = Math.round((now - date.getTime()) / 60_000);

      if (minutes < 1) return translate("common.justNow");
      if (minutes < 60) return translate("common.minutesAgo", { count: minutes });
      if (minutes < 60 * 24) {
        return translate("common.hoursAgo", { count: Math.round(minutes / 60) });
      }
      if (minutes < 60 * 24 * 90) {
        return translate("common.daysAgo", { count: Math.round(minutes / (60 * 24)) });
      }
      return translate("common.monthsAgo", { count: Math.round(minutes / (60 * 24 * 30)) });
    },

    formatNumber: (value, options) => new Intl.NumberFormat(tag, options).format(value),

    /**
     * Formats a monetary amount for display only. The stored value is never
     * altered — this is presentation.
     */
    formatCurrency: (value, currency) => {
      if (!currency) return new Intl.NumberFormat(tag).format(value);
      try {
        return new Intl.NumberFormat(tag, {
          style: "currency",
          currency,
          maximumFractionDigits: 0,
        }).format(value);
      } catch {
        // Unknown or malformed currency code: show the number plus the raw code.
        return `${new Intl.NumberFormat(tag).format(value)} ${currency}`;
      }
    },
  };
}
