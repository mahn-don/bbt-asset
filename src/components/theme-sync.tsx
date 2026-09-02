"use client";

import { useEffect } from "react";
import type { ThemePreference } from "@/lib/theme/config";

/**
 * Keeps `data-theme` correct after React re-renders.
 *
 * The boot script in <head> stamps `data-theme` before first paint, but it only
 * runs on a full page load. For the `system` preference the server cannot know
 * the resolved value, so it emits no `data-theme` attribute — and React's
 * reconciliation of <html> then strips the one the boot script set. The visible
 * symptom was picking "System" on a dark-preference OS flipping the UI to light
 * until the next hard reload.
 *
 * This effect runs after every commit, so it re-applies the resolved theme
 * whenever that happens. It also subscribes to `prefers-color-scheme` while the
 * preference is `system`, so changing the OS theme updates the app live.
 */
export function ThemeSync({ preference }: { preference: ThemePreference }) {
  useEffect(() => {
    const root = document.documentElement;

    const apply = () => {
      const resolved =
        preference === "system"
          ? window.matchMedia?.("(prefers-color-scheme: dark)").matches
            ? "dark"
            : "light"
          : preference;

      if (root.getAttribute("data-theme") !== resolved) {
        root.setAttribute("data-theme", resolved);
      }
      root.style.colorScheme = resolved;
      root.setAttribute("data-theme-preference", preference);
    };

    apply();

    if (preference !== "system") return;

    const query = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!query) return;

    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  });

  return null;
}
