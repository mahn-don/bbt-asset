"use client";

import { createContext, useContext, useMemo } from "react";
import { createTranslator, type Translator } from "@/lib/i18n/translator";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/config";

/**
 * Makes the translator available to client components.
 *
 * Only the locale crosses the boundary — the dictionaries are imported into
 * the client bundle and the translator is rebuilt there, so no large message
 * payload is serialised into the HTML.
 */

const I18nContext = createContext<Translator>(createTranslator(DEFAULT_LOCALE));

export function I18nProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  const translator = useMemo(() => createTranslator(locale), [locale]);
  return <I18nContext.Provider value={translator}>{children}</I18nContext.Provider>;
}

/** Client-side translator hook. Server components use `getTranslator()`. */
export function useT(): Translator {
  return useContext(I18nContext);
}
