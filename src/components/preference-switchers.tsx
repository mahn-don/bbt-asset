"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useT } from "@/components/i18n-provider";
import { LOCALES, LOCALE_SHORT, type Locale } from "@/lib/i18n/config";
import { THEMES, type ThemePreference } from "@/lib/theme/config";
import { cx } from "@/components/ui";

/**
 * Theme and language switchers.
 *
 * Both persist through the same endpoint (cookie + user row) and then call
 * `router.refresh()` so the server re-renders with the new preference. The
 * theme switcher additionally updates `data-theme` immediately, so the change
 * is visible before the round-trip completes.
 */

async function persist(update: { locale?: Locale; theme?: ThemePreference }): Promise<boolean> {
  try {
    const response = await fetch("/api/settings/preferences", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(update),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Applies the theme to the document immediately, mirroring the boot script. */
function applyThemeToDocument(preference: ThemePreference): void {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  root.setAttribute("data-theme-preference", preference);

  const resolved =
    preference === "system"
      ? window.matchMedia?.("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : preference;

  root.setAttribute("data-theme", resolved);
  root.style.colorScheme = resolved;
}

// --- Header controls -------------------------------------------------------

export function HeaderThemeToggle({ current }: { current: ThemePreference }) {
  const t = useT();
  const router = useRouter();
  const [value, setValue] = useState<ThemePreference>(current);
  const [, startTransition] = useTransition();

  // Cycle light → dark → system, which keeps the header to a single control.
  const order: ThemePreference[] = ["light", "dark", "system"];
  const labels: Record<ThemePreference, string> = {
    light: t.t("appearance.light"),
    dark: t.t("appearance.dark"),
    system: t.t("appearance.system"),
  };
  const glyphs: Record<ThemePreference, string> = { light: "☀", dark: "☾", system: "◐" };

  function cycle() {
    const next = order[(order.indexOf(value) + 1) % order.length] as ThemePreference;
    setValue(next);
    applyThemeToDocument(next);
    void persist({ theme: next }).then(() => startTransition(() => router.refresh()));
  }

  return (
    <button
      type="button"
      onClick={cycle}
      title={`${t.t("nav.theme")}: ${labels[value]}`}
      aria-label={`${t.t("nav.theme")}: ${labels[value]}`}
      className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[13px] text-ink-soft transition-colors hover:border-line-strong hover:text-ink"
    >
      <span aria-hidden="true">{glyphs[value]}</span>
      <span className="hidden sm:inline">{labels[value]}</span>
    </button>
  );
}

export function HeaderLocaleToggle({ current }: { current: Locale }) {
  const router = useRouter();
  const [value, setValue] = useState<Locale>(current);
  const [, startTransition] = useTransition();

  function select(next: Locale) {
    if (next === value) return;
    setValue(next);
    void persist({ locale: next }).then(() => startTransition(() => router.refresh()));
  }

  return (
    <div
      role="group"
      aria-label="Language"
      className="inline-flex overflow-hidden rounded-lg border border-line"
    >
      {LOCALES.map((locale) => (
        <button
          key={locale}
          type="button"
          onClick={() => select(locale)}
          aria-pressed={value === locale}
          className={cx(
            "px-2.5 py-1.5 text-xs font-semibold transition-colors",
            value === locale
              ? "bg-accent-soft text-accent-ink"
              : "text-ink-faint hover:bg-neutral-soft hover:text-ink",
          )}
        >
          {LOCALE_SHORT[locale]}
        </button>
      ))}
    </div>
  );
}

// --- Settings page controls ------------------------------------------------

export function ThemePicker({ current }: { current: ThemePreference }) {
  const t = useT();
  const router = useRouter();
  const [value, setValue] = useState<ThemePreference>(current);
  const [saved, setSaved] = useState(false);
  const [, startTransition] = useTransition();

  const help: Record<ThemePreference, string> = {
    light: t.t("appearance.lightHelp"),
    dark: t.t("appearance.darkHelp"),
    system: t.t("appearance.systemHelp"),
  };
  const labels: Record<ThemePreference, string> = {
    light: t.t("appearance.light"),
    dark: t.t("appearance.dark"),
    system: t.t("appearance.system"),
  };

  function select(next: ThemePreference) {
    setValue(next);
    applyThemeToDocument(next);
    void persist({ theme: next }).then((ok) => {
      setSaved(ok);
      startTransition(() => router.refresh());
    });
  }

  return (
    <div>
      <fieldset>
        <legend className="mb-3 text-[13px] font-medium text-ink">
          {t.t("appearance.theme")}
        </legend>

        <div className="grid gap-3 sm:grid-cols-3">
          {THEMES.map((theme) => (
            <label
              key={theme}
              className={cx(
                "flex cursor-pointer flex-col gap-1 rounded-xl border-2 px-4 py-3 transition-colors",
                value === theme
                  ? "border-accent bg-accent-soft"
                  : "border-line bg-surface hover:border-line-strong",
              )}
            >
              <span className="flex items-center gap-2">
                <input
                  type="radio"
                  name="theme"
                  value={theme}
                  checked={value === theme}
                  onChange={() => select(theme)}
                  className="accent-accent"
                />
                <span className="text-sm font-semibold text-ink">{labels[theme]}</span>
              </span>
              <span className="type-help pl-6">{help[theme]}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {saved ? (
        <p className="mt-3 text-[13px] text-success-ink">{t.t("appearance.saved")}</p>
      ) : null}
    </div>
  );
}

export function LanguagePicker({ current }: { current: Locale }) {
  const t = useT();
  const router = useRouter();
  const [value, setValue] = useState<Locale>(current);
  const [saved, setSaved] = useState(false);
  const [, startTransition] = useTransition();

  const labels: Record<Locale, string> = { en: "English", vi: "Tiếng Việt" };

  function select(next: Locale) {
    setValue(next);
    void persist({ locale: next }).then((ok) => {
      setSaved(ok);
      startTransition(() => router.refresh());
    });
  }

  return (
    <div className="max-w-sm">
      <label htmlFor="locale-select" className="mb-1.5 block text-[13px] font-medium text-ink">
        {t.t("language.select")}
      </label>
      <select
        id="locale-select"
        value={value}
        onChange={(event) => select(event.target.value as Locale)}
        className="w-full rounded-lg border border-field-border bg-field px-3 py-2 text-sm text-ink transition-colors hover:border-line-strong focus:border-accent focus:outline-none"
      >
        {LOCALES.map((locale) => (
          <option key={locale} value={locale}>
            {labels[locale]}
          </option>
        ))}
      </select>

      {saved ? (
        <p className="mt-3 text-[13px] text-success-ink">{t.t("language.saved")}</p>
      ) : null}
    </div>
  );
}
