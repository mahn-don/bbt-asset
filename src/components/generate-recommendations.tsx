"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useT } from "@/components/i18n-provider";
import { buttonClass, cx } from "@/components/ui";
import { ASSET_TYPES } from "@/lib/enums";

/**
 * High-value asset classes mirrored from the server's FOCUS_ASSET_TYPES.
 * Kept here as a literal so this client component never imports the server-only
 * query module.
 */
const HIGH_VALUE_TYPES = ["API", "WILDCARD", "REPOSITORY", "ANDROID", "IOS"] as const;

/**
 * Runs a bounded, value-prioritised evaluation batch (the funnel's expensive
 * tip) and refreshes the page to show the new recommendations.
 */
export function GenerateRecommendations() {
  const t = useT();
  const router = useRouter();

  const [focus, setFocus] = useState<"highValue" | "all">("highValue");
  const [batch, setBatch] = useState(25);
  const [state, setState] = useState<{ busy: boolean; message: string | null; error: boolean }>({
    busy: false,
    message: null,
    error: false,
  });

  async function generate() {
    setState({ busy: true, message: null, error: false });

    try {
      const response = await fetch("/api/ai-supporter/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          focus: focus === "highValue" ? [...HIGH_VALUE_TYPES] : [...ASSET_TYPES],
          limit: batch,
        }),
      });

      const body = (await response.json().catch(() => ({}))) as {
        evaluated?: number;
        failed?: number;
        error?: { message?: string };
      };

      if (!response.ok) {
        setState({ busy: false, error: true, message: body.error?.message ?? t.t("common.networkError") });
        return;
      }

      setState({
        busy: false,
        error: false,
        message: t.t("aiSupporter.generated", {
          evaluated: body.evaluated ?? 0,
          failed: body.failed ?? 0,
        }),
      });
      router.refresh();
    } catch {
      setState({ busy: false, error: true, message: t.t("common.networkError") });
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-ink-soft">
            {t.t("aiSupporter.focus")}
          </span>
          <select
            value={focus}
            onChange={(event) => setFocus(event.target.value as "highValue" | "all")}
            disabled={state.busy}
            className="rounded-lg border border-field-border bg-field px-3 py-2 text-sm text-ink"
          >
            <option value="highValue">{t.t("aiSupporter.focusHighValue")}</option>
            <option value="all">{t.t("aiSupporter.focusAll")}</option>
          </select>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-ink-soft">
            {t.t("aiSupporter.batchSize")}
          </span>
          <select
            value={batch}
            onChange={(event) => setBatch(Number(event.target.value))}
            disabled={state.busy}
            className="rounded-lg border border-field-border bg-field px-3 py-2 text-sm text-ink"
          >
            {[10, 25, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={generate}
          disabled={state.busy}
          className={buttonClass("primary")}
        >
          {state.busy ? t.t("aiSupporter.generating") : t.t("aiSupporter.generate")}
        </button>
      </div>

      <p className="type-help">{t.t("aiSupporter.generateHelp")}</p>

      {state.message ? (
        <p className={cx("text-[13px]", state.error ? "text-danger" : "text-success-ink")}>
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
