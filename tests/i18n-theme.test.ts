import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { en } from "@/lib/i18n/dictionaries/en";
import { vi as viDict } from "@/lib/i18n/dictionaries/vi";
import { createTranslator } from "@/lib/i18n/translator";
import { DEFAULT_LOCALE, LOCALES, isLocale, normalizeLocale } from "@/lib/i18n/config";
import {
  DEFAULT_THEME,
  THEMES,
  THEME_INIT_SCRIPT,
  isThemePreference,
  normalizeTheme,
} from "@/lib/theme/config";

/**
 * i18n and theme guarantees.
 */

describe("dictionaries", () => {
  it("has a Vietnamese entry for every English key", () => {
    const missing = (Object.keys(en) as (keyof typeof en)[]).filter((key) => !viDict[key]);
    expect(missing).toEqual([]);
  });

  it("has no extra Vietnamese keys", () => {
    const extra = Object.keys(viDict).filter((key) => !(key in en));
    expect(extra).toEqual([]);
  });

  it("keeps no untranslated Vietnamese values for user-facing prose", () => {
    // Some values legitimately match: brand names, technical terms.
    const allowedIdentical = new Set([
      "app.name",
      "app.brandShort",
      "auth.email",
      "settings.ai",
      "aiSettings.baseUrl",
      "aiSettings.temperature",
      "asset.safeHarbor",
      "syncHistory.col.rateLimits",
    ]);

    const identical = (Object.keys(en) as (keyof typeof en)[]).filter(
      (key) => en[key] === viDict[key] && !allowedIdentical.has(key),
    );

    expect(identical).toEqual([]);
  });

  it("uses the same interpolation placeholders in both languages", () => {
    const placeholders = (value: string) =>
      [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(placeholders(viDict[key]), `placeholders differ for ${key}`).toEqual(
        placeholders(en[key]),
      );
    }
  });
});

describe("translator", () => {
  it("renders English", () => {
    const t = createTranslator("en");
    expect(t.t("nav.dashboard")).toBe("Dashboard");
    expect(t.t("nav.assets")).toBe("Assets");
    expect(t.t("settings.appearance")).toBe("Appearance");
  });

  it("renders Vietnamese", () => {
    const t = createTranslator("vi");
    expect(t.t("nav.dashboard")).toBe("Tổng quan");
    expect(t.t("nav.assets")).toBe("Tài sản");
    expect(t.t("nav.programs")).toBe("Chương trình");
    expect(t.t("nav.changes")).toBe("Thay đổi");
    expect(t.t("settings.title")).toBe("Cài đặt");
    expect(t.t("dashboard.opportunities")).toBe("Cơ hội hôm nay");
    expect(t.t("score.opportunityScore")).toBe("Điểm cơ hội");
    expect(t.t("asset.bountyEligible")).toBe("Đủ điều kiện nhận thưởng");
    expect(t.t("scopeStatus.IN_SCOPE")).toBe("Trong phạm vi");
  });

  it("interpolates parameters", () => {
    expect(createTranslator("en").t("common.pageOf", { page: 2, total: 9 })).toBe("Page 2 of 9");
    expect(createTranslator("vi").t("common.pageOf", { page: 2, total: 9 })).toBe("Trang 2 / 9");
  });

  it("pluralises in English and stays invariant in Vietnamese", () => {
    const enT = createTranslator("en");
    expect(enT.plural("assets.count", 1)).toBe("1 asset");
    expect(enT.plural("assets.count", 4)).toBe("4 assets");

    // Vietnamese has no plural inflection; the singular form is always correct.
    const viT = createTranslator("vi");
    expect(viT.plural("assets.count", 1)).toBe("1 tài sản");
    expect(viT.plural("assets.count", 4)).toBe("4 tài sản");
  });

  it("falls back to English for an unknown key, then to the key itself", () => {
    const t = createTranslator("vi");
    expect(t.maybe("does.not.exist", "fallback text")).toBe("fallback text");
  });

  it("localises relative time", () => {
    const now = Date.UTC(2026, 7, 31, 12, 0, 0);
    const nineMinutesAgo = new Date(now - 9 * 60_000);
    const twoHoursAgo = new Date(now - 2 * 60 * 60_000);
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60_000);

    const enT = createTranslator("en");
    expect(enT.formatRelative(nineMinutesAgo, now)).toBe("9m ago");
    expect(enT.formatRelative(twoHoursAgo, now)).toBe("2h ago");
    expect(enT.formatRelative(sevenDaysAgo, now)).toBe("7d ago");

    const viT = createTranslator("vi");
    expect(viT.formatRelative(nineMinutesAgo, now)).toBe("9 phút trước");
    expect(viT.formatRelative(twoHoursAgo, now)).toBe("2 giờ trước");
    expect(viT.formatRelative(sevenDaysAgo, now)).toBe("7 ngày trước");
  });

  it("localises numbers and currency without altering the value", () => {
    const enT = createTranslator("en");
    const viT = createTranslator("vi");

    expect(enT.formatNumber(1234567)).toBe("1,234,567");
    // Vietnamese uses "." as the thousands separator.
    expect(viT.formatNumber(1234567)).toBe("1.234.567");

    // Presentation differs; the underlying amount never does.
    expect(enT.formatCurrency(15000, "USD")).toContain("15,000");
    expect(viT.formatCurrency(15000, "USD")).toContain("15.000");

    // An unknown currency code degrades gracefully rather than throwing.
    expect(enT.formatCurrency(100, "NOTACODE")).toContain("100");
  });

  it("formats dates per locale", () => {
    const date = new Date(Date.UTC(2026, 2, 15, 10, 30));
    expect(createTranslator("en").formatDate(date, { dateStyle: "medium" })).toMatch(/2026/);
    expect(createTranslator("vi").formatDate(date, { dateStyle: "medium" })).toMatch(/2026/);
  });
});

describe("locale config", () => {
  it("validates and normalises", () => {
    expect(isLocale("en")).toBe(true);
    expect(isLocale("vi")).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(normalizeLocale("vi")).toBe("vi");
    expect(normalizeLocale("klingon")).toBe(DEFAULT_LOCALE);
    expect(normalizeLocale(undefined)).toBe(DEFAULT_LOCALE);
    expect(LOCALES).toEqual(["en", "vi"]);
  });
});

describe("theme config", () => {
  it("supports light, dark and system", () => {
    expect(THEMES).toEqual(["light", "dark", "system"]);
    expect(isThemePreference("light")).toBe(true);
    expect(isThemePreference("dark")).toBe(true);
    expect(isThemePreference("system")).toBe(true);
    expect(isThemePreference("neon")).toBe(false);
    expect(normalizeTheme("neon")).toBe(DEFAULT_THEME);
  });

  it("resolves system against prefers-color-scheme before paint", () => {
    // The no-flash guarantee depends on this script reading the media query
    // and stamping data-theme synchronously in <head>.
    expect(THEME_INIT_SCRIPT).toContain("prefers-color-scheme: dark");
    expect(THEME_INIT_SCRIPT).toContain("data-theme");
    expect(THEME_INIT_SCRIPT).toContain("colorScheme");
  });
});

describe("design tokens", () => {
  const css = fs.readFileSync(
    path.join(process.cwd(), "src", "app", "globals.css"),
    "utf8",
  );

  const SEMANTIC_TOKENS = [
    "--canvas",
    "--surface",
    "--elevated",
    "--sunken",
    "--line",
    "--line-strong",
    "--ink",
    "--ink-soft",
    "--ink-faint",
    "--accent",
    "--accent-hover",
    "--accent-soft",
    "--accent-ink",
    "--accent-contrast",
    "--success",
    "--warning",
    "--danger",
    "--info",
    "--field",
    "--field-border",
    "--row-hover",
    "--header-bg",
    "--sidebar-active",
  ];

  it("defines every semantic token in the light palette", () => {
    const light = css.slice(css.indexOf(":root {", css.indexOf("--- Light")), css.indexOf('[data-theme="dark"]'));
    for (const token of SEMANTIC_TOKENS) {
      expect(light, `light palette is missing ${token}`).toContain(`${token}:`);
    }
  });

  it("defines every semantic token in the dark palette", () => {
    const dark = css.slice(css.indexOf('[data-theme="dark"] {'), css.indexOf("@theme inline {"));
    for (const token of SEMANTIC_TOKENS) {
      expect(dark, `dark palette is missing ${token}`).toContain(`${token}:`);
    }
  });

  it("maps tokens to Tailwind utilities so the theme switches at runtime", () => {
    const mapping = css.slice(css.indexOf("@theme inline {"));
    expect(mapping).toContain("--color-surface: var(--surface)");
    expect(mapping).toContain("--color-ink: var(--ink)");
    expect(mapping).toContain("--color-line: var(--line)");
  });

  it("declares color-scheme for both themes", () => {
    expect(css).toContain("color-scheme: light");
    expect(css).toContain("color-scheme: dark");
  });

  it("uses genuinely dark values in dark mode, not mid-gray", () => {
    const dark = css.slice(css.indexOf('[data-theme="dark"] {'), css.indexOf("@theme inline {"));
    const canvas = /--canvas:\s*#([0-9a-f]{6})/i.exec(dark)?.[1];
    expect(canvas).toBeDefined();

    // Each channel well below mid-gray: this is the "no gray-on-gray" guarantee.
    const [r, g, b] = [0, 2, 4].map((offset) => parseInt(canvas!.slice(offset, offset + 2), 16));
    expect(Math.max(r!, g!, b!)).toBeLessThan(0x30);
  });

  it("uses genuinely light values in light mode", () => {
    const light = css.slice(css.indexOf(":root {", css.indexOf("--- Light")), css.indexOf('[data-theme="dark"]'));
    const canvas = /--canvas:\s*#([0-9a-f]{6})/i.exec(light)?.[1];
    expect(canvas).toBeDefined();

    const [r, g, b] = [0, 2, 4].map((offset) => parseInt(canvas!.slice(offset, offset + 2), 16));
    expect(Math.min(r!, g!, b!)).toBeGreaterThan(0xe0);
  });
});
