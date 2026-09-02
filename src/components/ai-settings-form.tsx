"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useT } from "@/components/i18n-provider";
import { Badge, Card, Notice, buttonClass, cx, inputClass } from "@/components/ui";
import type { AiProviderKind, AiSettingsRecord } from "@/lib/ai/settings";

/**
 * AI Settings form.
 *
 * The API key is write-only: the server never sends one back, so this
 * component has no way to display a stored key. It renders "Configured" plus a
 * masked hint, and the input is only ever used to submit a *replacement*.
 */

const PROVIDER_LABELS: Record<AiProviderKind, string> = {
  ANTHROPIC: "Anthropic",
  OPENAI: "OpenAI",
  OPENAI_COMPATIBLE: "OpenAI-compatible (custom endpoint)",
  HEURISTIC: "Heuristic rule engine (no model)",
};

const CUSTOM_MODEL = "__custom__";

interface Props {
  initial: AiSettingsRecord;
  catalogue: Record<string, { id: string; label: string }[]>;
}

type Status =
  | { kind: "idle" }
  | { kind: "busy"; action: "save" | "test" | "delete" }
  | { kind: "error"; message: string }
  | { kind: "success"; message: string };

export function AiSettingsForm({ initial, catalogue }: Props) {
  const t = useT();
  const router = useRouter();

  const [settings, setSettings] = useState(initial);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [provider, setProvider] = useState<AiProviderKind>(initial.provider);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl ?? "");

  const models = catalogue[provider] ?? [];
  const initialIsCustom =
    Boolean(initial.model) && !models.some((entry) => entry.id === initial.model);

  const [modelChoice, setModelChoice] = useState<string>(
    initialIsCustom ? CUSTOM_MODEL : (initial.model ?? models[0]?.id ?? CUSTOM_MODEL),
  );
  const [customModel, setCustomModel] = useState(initialIsCustom ? (initial.model ?? "") : "");

  const [flags, setFlags] = useState({
    enabled: initial.enabled,
    scopeEvaluationEnabled: initial.scopeEvaluationEnabled,
    changeAnalysisEnabled: initial.changeAnalysisEnabled,
    autoEvaluateNewScopes: initial.autoEvaluateNewScopes,
    autoReevaluateChangedScopes: initial.autoReevaluateChangedScopes,
    heuristicFallbackEnabled: initial.heuristicFallbackEnabled,
  });

  const [temperature, setTemperature] = useState(
    initial.temperature === null ? "" : String(initial.temperature),
  );
  const [maxTokens, setMaxTokens] = useState(
    initial.maxTokens === null ? "" : String(initial.maxTokens),
  );

  const busy = status.kind === "busy";
  const needsKey = provider !== "HEURISTIC";
  const isCustomEndpoint = provider === "OPENAI_COMPATIBLE";
  const resolvedModel = modelChoice === CUSTOM_MODEL ? customModel.trim() : modelChoice;

  function onProviderChange(next: AiProviderKind) {
    setProvider(next);
    const nextModels = catalogue[next] ?? [];
    setModelChoice(nextModels[0]?.id ?? CUSTOM_MODEL);
    setCustomModel("");
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setStatus({ kind: "busy", action: "save" });

    try {
      const response = await fetch("/api/settings/ai", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider,
          model: resolvedModel || undefined,
          baseUrl: isCustomEndpoint ? baseUrl : undefined,
          // Only sent when the operator actually typed a replacement.
          apiKey: apiKey.trim() || undefined,
          ...flags,
          temperature: temperature.trim() === "" ? null : Number(temperature),
          maxTokens: maxTokens.trim() === "" ? null : Number(maxTokens),
        }),
      });

      const body = (await response.json().catch(() => ({}))) as
        | AiSettingsRecord
        | { error?: { message?: string } };

      if (!response.ok) {
        const message =
          "error" in body ? (body.error?.message ?? t.t("common.networkError")) : t.t("common.networkError");
        setStatus({ kind: "error", message });
        return;
      }

      setSettings(body as AiSettingsRecord);
      setApiKey("");
      setStatus({ kind: "success", message: t.t("aiSettings.saved") });
      router.refresh();
    } catch {
      setStatus({ kind: "error", message: t.t("common.networkError") });
    }
  }

  async function testConnection() {
    setStatus({ kind: "busy", action: "test" });

    try {
      const response = await fetch("/api/settings/ai/test", { method: "POST" });
      const body = (await response.json().catch(() => ({}))) as {
        result?: { status?: string; messageKey?: string; code?: string };
        settings?: AiSettingsRecord;
        error?: { message?: string };
      };

      if (!response.ok) {
        setStatus({ kind: "error", message: body.error?.message ?? t.t("common.networkError") });
        return;
      }

      if (body.settings) setSettings(body.settings);

      const message = t.maybe(body.result?.messageKey ?? "", t.t("aiTest.unavailable"));

      setStatus(
        body.result?.status === "CONNECTED"
          ? { kind: "success", message }
          : { kind: "error", message },
      );
      router.refresh();
    } catch {
      setStatus({ kind: "error", message: t.t("common.networkError") });
    }
  }

  async function deleteKey() {
    if (!window.confirm(t.t("aiSettings.deleteKeyConfirm"))) return;

    setStatus({ kind: "busy", action: "delete" });

    try {
      const response = await fetch("/api/settings/ai/key", { method: "DELETE" });
      const body = (await response.json().catch(() => ({}))) as AiSettingsRecord;

      if (!response.ok) {
        setStatus({ kind: "error", message: t.t("common.networkError") });
        return;
      }

      setSettings(body);
      setStatus({ kind: "success", message: t.t("aiSettings.keyDeleted") });
      router.refresh();
    } catch {
      setStatus({ kind: "error", message: t.t("common.networkError") });
    }
  }

  const statusTone =
    settings.connectionStatus === "CONNECTED"
      ? "success"
      : settings.connectionStatus === "NOT_CONFIGURED"
        ? "neutral"
        : settings.connectionStatus === "RATE_LIMITED"
          ? "warning"
          : "danger";

  return (
    <form onSubmit={save} className="flex flex-col gap-6">
      {/* Heuristic-only banner: never let the rule engine look like a model. */}
      {!settings.hasApiKey && settings.provider !== "HEURISTIC" ? (
        <Notice tone="warning">
          <span className="font-semibold">{t.t("aiSettings.notConfiguredTitle")}</span>
          <br />
          {t.t("aiSettings.notConfiguredBody")}
        </Notice>
      ) : null}

      {settings.provider === "HEURISTIC" ? (
        <Notice tone="info">{t.t("aiSettings.notConfiguredBody")}</Notice>
      ) : null}

      <Card title={t.t("aiSettings.provider")}>
        <div className="grid gap-5 px-4 py-4 md:grid-cols-2">
          <div>
            <label htmlFor="ai-provider" className="mb-1.5 block text-[13px] font-medium text-ink">
              {t.t("aiSettings.provider")}
            </label>
            <select
              id="ai-provider"
              value={provider}
              onChange={(event) => onProviderChange(event.target.value as AiProviderKind)}
              className={inputClass}
            >
              {(Object.keys(PROVIDER_LABELS) as AiProviderKind[]).map((kind) => (
                <option key={kind} value={kind}>
                  {PROVIDER_LABELS[kind]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <span className="mb-1.5 block text-[13px] font-medium text-ink">
              {t.t("aiSettings.status")}
            </span>
            <div className="flex items-center gap-2 py-1.5">
              <Badge tone={statusTone}>
                {t.maybe(`connection.${settings.connectionStatus}`, settings.connectionStatus)}
              </Badge>
              {settings.lastErrorSummary ? (
                <span className="type-help">{t.maybe(settings.lastErrorSummary, "")}</span>
              ) : null}
            </div>
          </div>

          {needsKey ? (
            <>
              <div>
                <label htmlFor="ai-key" className="mb-1.5 block text-[13px] font-medium text-ink">
                  {t.t("aiSettings.apiKey")}
                </label>

                <div className="mb-2 flex items-center gap-2">
                  {settings.hasApiKey ? (
                    <>
                      <Badge tone="success">{t.t("aiSettings.apiKeyConfigured")}</Badge>
                      <span className="font-mono text-xs text-ink-faint">
                        {settings.credentialHint ?? "••••••••"}
                      </span>
                    </>
                  ) : (
                    <Badge tone="neutral">{t.t("aiSettings.apiKeyNotConfigured")}</Badge>
                  )}
                </div>

                <input
                  id="ai-key"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={t.t("aiSettings.apiKeyPlaceholder")}
                  className={cx(inputClass, "font-mono")}
                />
                <p className="type-help mt-1.5">{t.t("aiSettings.apiKeyHelp")}</p>
              </div>

              <div>
                <label htmlFor="ai-model" className="mb-1.5 block text-[13px] font-medium text-ink">
                  {t.t("aiSettings.model")}
                </label>
                <select
                  id="ai-model"
                  value={modelChoice}
                  onChange={(event) => setModelChoice(event.target.value)}
                  className={inputClass}
                >
                  {models.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.label}
                    </option>
                  ))}
                  <option value={CUSTOM_MODEL}>{t.t("aiSettings.customModel")}</option>
                </select>

                {modelChoice === CUSTOM_MODEL ? (
                  <input
                    type="text"
                    value={customModel}
                    onChange={(event) => setCustomModel(event.target.value)}
                    placeholder={t.t("aiSettings.customModelPlaceholder")}
                    className={cx(inputClass, "mt-2 font-mono")}
                  />
                ) : null}
              </div>
            </>
          ) : null}

          {isCustomEndpoint ? (
            <div className="md:col-span-2">
              <label htmlFor="ai-base-url" className="mb-1.5 block text-[13px] font-medium text-ink">
                {t.t("aiSettings.baseUrl")}
              </label>
              <input
                id="ai-base-url"
                type="url"
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder="https://api.example.com"
                className={cx(inputClass, "font-mono")}
              />
              <p className="type-help mt-1.5">{t.t("aiSettings.baseUrlHelp")}</p>
            </div>
          ) : null}

          {settings.environmentKeyPresent && !settings.hasApiKey ? (
            <p className="type-help md:col-span-2">{t.t("aiSettings.envKeyNote")}</p>
          ) : null}
        </div>
      </Card>

      <Card title={t.t("aiSettings.features")}>
        <div className="flex flex-col gap-1 px-4 py-3">
          <Toggle
            label={t.t("aiSettings.enabled")}
            checked={flags.enabled}
            onChange={(value) => setFlags((f) => ({ ...f, enabled: value }))}
          />
          <Toggle
            label={t.t("aiSettings.scopeEvaluation")}
            checked={flags.scopeEvaluationEnabled}
            onChange={(value) => setFlags((f) => ({ ...f, scopeEvaluationEnabled: value }))}
          />
          <Toggle
            label={t.t("aiSettings.changeAnalysis")}
            checked={flags.changeAnalysisEnabled}
            onChange={(value) => setFlags((f) => ({ ...f, changeAnalysisEnabled: value }))}
          />
          <Toggle
            label={t.t("aiSettings.autoEvaluateNew")}
            checked={flags.autoEvaluateNewScopes}
            onChange={(value) => setFlags((f) => ({ ...f, autoEvaluateNewScopes: value }))}
          />
          <Toggle
            label={t.t("aiSettings.autoReevaluateChanged")}
            checked={flags.autoReevaluateChangedScopes}
            onChange={(value) => setFlags((f) => ({ ...f, autoReevaluateChangedScopes: value }))}
          />
          <Toggle
            label={t.t("aiSettings.heuristicFallback")}
            help={t.t("aiSettings.heuristicFallbackHelp")}
            checked={flags.heuristicFallbackEnabled}
            onChange={(value) => setFlags((f) => ({ ...f, heuristicFallbackEnabled: value }))}
          />
        </div>
      </Card>

      {/* Advanced settings stay collapsed by default. */}
      <details
        open={showAdvanced}
        onToggle={(event) => setShowAdvanced((event.target as HTMLDetailsElement).open)}
        className="rounded-xl border border-line bg-surface shadow-[var(--shadow-card)]"
      >
        <summary className="cursor-pointer px-4 py-3 text-[13px] font-semibold text-ink">
          {t.t("aiSettings.advanced")}
        </summary>
        <div className="grid gap-4 border-t border-line px-4 py-4 md:grid-cols-2">
          <div>
            <label htmlFor="ai-temp" className="mb-1.5 block text-[13px] font-medium text-ink">
              {t.t("aiSettings.temperature")}
            </label>
            <input
              id="ai-temp"
              type="number"
              min={0}
              max={2}
              step={0.1}
              value={temperature}
              onChange={(event) => setTemperature(event.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="ai-max-tokens" className="mb-1.5 block text-[13px] font-medium text-ink">
              {t.t("aiSettings.maxTokens")}
            </label>
            <input
              id="ai-max-tokens"
              type="number"
              min={256}
              max={128000}
              step={256}
              value={maxTokens}
              onChange={(event) => setMaxTokens(event.target.value)}
              className={inputClass}
            />
          </div>
        </div>
      </details>

      {status.kind === "error" ? <Notice tone="danger">{status.message}</Notice> : null}
      {status.kind === "success" ? <Notice tone="success">{status.message}</Notice> : null}

      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={busy} className={buttonClass("primary")}>
          {status.kind === "busy" && status.action === "save"
            ? t.t("common.saving")
            : t.t("aiSettings.saveSettings")}
        </button>

        <button
          type="button"
          onClick={testConnection}
          disabled={busy}
          className={buttonClass("secondary")}
        >
          {status.kind === "busy" && status.action === "test"
            ? t.t("aiSettings.testing")
            : t.t("aiSettings.testConnection")}
        </button>

        {settings.hasApiKey ? (
          <button
            type="button"
            onClick={deleteKey}
            disabled={busy}
            className={buttonClass("danger", "ml-auto")}
          >
            {t.t("aiSettings.deleteKey")}
          </button>
        ) : null}
      </div>
    </form>
  );
}

function Toggle({
  label,
  help,
  checked,
  onChange,
}: {
  label: string;
  help?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-neutral-soft">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-4 w-4 accent-accent"
      />
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-ink">{label}</span>
        {help ? <span className="type-help mt-0.5 block">{help}</span> : null}
      </span>
    </label>
  );
}
