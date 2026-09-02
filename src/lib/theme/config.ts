/**
 * Theme configuration.
 *
 * `light` and `dark` are applied as `data-theme` on <html>. `system` resolves
 * from `prefers-color-scheme` in a tiny blocking script, so the correct theme
 * is painted on the very first frame with no flash.
 */

export const THEMES = ["light", "dark", "system"] as const;
export type ThemePreference = (typeof THEMES)[number];

/** The two themes that can actually be rendered. */
export type ResolvedTheme = "light" | "dark";

export const DEFAULT_THEME: ThemePreference = "system";

export const THEME_COOKIE = "bbi_theme";

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

export function normalizeTheme(value: unknown): ThemePreference {
  return isThemePreference(value) ? value : DEFAULT_THEME;
}

/**
 * Inline script that runs before first paint.
 *
 * It resolves `system` against the media query and stamps `data-theme` on the
 * document element. Kept deliberately tiny and dependency-free, and wrapped in
 * try/catch so a browser that blocks matchMedia still renders.
 */
export const THEME_INIT_SCRIPT = `
(function(){try{
var d=document.documentElement;
var p=d.getAttribute('data-theme-preference')||'system';
var t=p;
if(p==='system'){t=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}
d.setAttribute('data-theme',t);
d.style.colorScheme=t;
}catch(e){}})();
`.trim();
