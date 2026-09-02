"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { IntegrationSummary } from "@/lib/queries/integrations";
import { useT } from "@/components/i18n-provider";
import {
  Badge,
  ConnectionBadge,
  Notice,
  RelativeTime,
  SyncStatusBadge,
  buttonClass,
  cx,
  inputClass,
} from "@/components/ui";

/**
 * Provider integration card.
 *
 * Credential values live only in local component state until submitted, and
 * the server never sends any secret back — the card renders the masked hint
 * from the integration summary instead.
 */

type ActionState =
  | { kind: "idle" }
  | { kind: "busy"; action: string }
  | { kind: "error"; message: string }
  | { kind: "success"; message: string };

export function IntegrationCard({ integration }: { integration: IntegrationSummary }) {
  const t = useT();
  const router = useRouter();
  const [state, setState] = useState<ActionState>({ kind: "idle" });
  const [configuring, setConfiguring] = useState(false);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const slug = integration.providerSlug;
  const busy = state.kind === "busy";

  async function call(
    action: string,
    path: string,
    init: RequestInit,
  ): Promise<Record<string, unknown> | null> {
    setState({ kind: "busy", action });
    setFieldErrors({});

    try {
      const response = await fetch(path, {
        ...init,
        headers: { "content-type": "application/json", ...(init.headers ?? {}) },
      });

      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      if (!response.ok) {
        const error = body.error as
          | { message?: string; fieldErrors?: Record<string, string> }
          | undefined;
        if (error?.fieldErrors) setFieldErrors(error.fieldErrors);
        setState({
          kind: "error",
          message:
            error?.message ?? t.t("integrations.requestFailed", { status: response.status }),
        });
        return null;
      }

      router.refresh();
      return body;
    } catch {
      setState({ kind: "error", message: t.t("common.networkError") });
      return null;
    }
  }

  async function saveCredentials(event: React.FormEvent) {
    event.preventDefault();

    const body = await call("save", `/api/integrations/${slug}`, {
      method: "PUT",
      body: JSON.stringify({ credentials: fieldValues }),
    });

    if (body) {
      setFieldValues({});
      setConfiguring(false);
      setState({ kind: "success", message: t.t("integrations.credentialsSaved") });
    }
  }

  async function testConnection() {
    const body = await call("test", `/api/integrations/${slug}/test`, { method: "POST" });
    if (body) {
      const result = body.result as { status?: string; message?: string } | undefined;
      setState(
        result?.status === "CONNECTED" || result?.status === "READY"
          ? { kind: "success", message: result.message ?? t.t("integrations.connected") }
          : { kind: "error", message: result?.message ?? t.t("integrations.testFailed") },
      );
    }
  }

  async function sync() {
    const body = await call("sync", `/api/integrations/${slug}/sync`, {
      method: "POST",
      body: JSON.stringify({}),
    });

    if (body) {
      const result = body.result as
        | {
            status?: string;
            programsReceived?: number;
            scopesReceived?: number;
            changesDetected?: number;
            aiJobsEnqueued?: number;
            errorSummary?: string;
          }
        | undefined;

      const summary = t.t("integrations.syncSummary", {
        status: result?.status ?? "DONE",
        programs: result?.programsReceived ?? 0,
        scopes: result?.scopesReceived ?? 0,
        changes: result?.changesDetected ?? 0,
        jobs: result?.aiJobsEnqueued ?? 0,
      });

      setState(
        result?.status === "FAILED"
          ? { kind: "error", message: result.errorSummary ?? summary }
          : { kind: "success", message: summary },
      );
    }
  }

  async function toggleEnabled(enabled: boolean) {
    const body = await call("enabled", `/api/integrations/${slug}/enabled`, {
      method: "PATCH",
      body: JSON.stringify({ enabled }),
    });
    if (body) {
      setState({
        kind: "success",
        message: enabled
          ? t.t("integrations.integrationEnabled")
          : t.t("integrations.integrationDisabled"),
      });
    }
  }

  async function disconnect() {
    const body = await call("disconnect", `/api/integrations/${slug}/credentials`, {
      method: "DELETE",
    });
    if (body) setState({ kind: "success", message: t.t("integrations.credentialsDeleted") });
  }

  const requiresCredentials = integration.capabilities.requiresCredentials;

  return (
    <section className="rounded-xl border border-line bg-surface shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="type-section-title">{integration.displayName}</h2>
            <ConnectionBadge status={integration.connectionStatus} t={t} />
            {integration.enabled ? <Badge tone="accent">{t.t("common.enabled")}</Badge> : null}
            {!requiresCredentials ? (
              <Badge tone="neutral">{t.t("integrations.noCredentials")}</Badge>
            ) : null}
          </div>
          {integration.capabilities.notes ? (
            <p className="type-meta mt-1.5 max-w-2xl">{integration.capabilities.notes}</p>
          ) : null}
        </div>

        <div className="flex gap-6 text-right">
          <div>
            <span className="type-label block">{t.t("integrations.programs")}</span>
            <span className="font-mono text-lg font-bold tabular-nums text-ink">
              {integration.programCount}
            </span>
          </div>
          <div>
            <span className="type-label block">{t.t("integrations.activeScopes")}</span>
            <span className="font-mono text-lg font-bold tabular-nums text-ink">
              {integration.activeScopeCount}
            </span>
          </div>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-b border-line px-4 py-3.5 lg:grid-cols-4">
        <div>
          <dt className="type-label">{t.t("integrations.credential")}</dt>
          <dd className="mt-1 font-mono text-[13px] text-ink-soft">
            {requiresCredentials
              ? (integration.credentialHint ?? t.t("connection.NOT_CONFIGURED"))
              : t.t("integrations.notRequired")}
          </dd>
        </div>
        <div>
          <dt className="type-label">{t.t("integrations.lastTest")}</dt>
          <dd className="mt-1 text-[13px] text-ink-soft">
            <RelativeTime date={integration.lastTestedAt} fallback={t.t("common.never")} t={t} />
          </dd>
        </div>
        <div>
          <dt className="type-label">{t.t("integrations.lastSuccessfulSync")}</dt>
          <dd className="mt-1 text-[13px] text-ink-soft">
            <RelativeTime
              date={integration.lastSuccessfulSyncAt}
              fallback={t.t("common.never")}
              t={t}
            />
          </dd>
        </div>
        <div>
          <dt className="type-label">{t.t("integrations.lastAttemptedSync")}</dt>
          <dd className="mt-1 text-[13px] text-ink-soft">
            <RelativeTime
              date={integration.lastAttemptedSyncAt}
              fallback={t.t("common.never")}
              t={t}
            />
          </dd>
        </div>
      </dl>

      {integration.lastErrorSummary ? (
        <div className="border-b border-line px-4 py-2.5">
          <p className="text-[13px] text-danger-ink">
            <span className="font-semibold">{integration.lastErrorCode ?? "Error"}:</span>{" "}
            {integration.lastErrorSummary}
          </p>
        </div>
      ) : null}

      {integration.lastSyncRun ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5 text-[13px] text-ink-soft">
          <span>{t.t("integrations.lastRun")}</span>
          <SyncStatusBadge status={integration.lastSyncRun.status} t={t} />
          <span>
            <RelativeTime date={integration.lastSyncRun.startedAt} t={t} /> ·{" "}
            {integration.lastSyncRun.programsReceived} {t.t("integrations.programs").toLowerCase()} ·{" "}
            {integration.lastSyncRun.scopesReceived} {t.t("programs.col.scopes").toLowerCase()} ·{" "}
            {integration.lastSyncRun.changesDetected} {t.t("changes.title").toLowerCase()}
          </span>
        </div>
      ) : null}

      {configuring && requiresCredentials ? (
        <form onSubmit={saveCredentials} className="border-b border-line px-4 py-4">
          <p className="type-meta mb-3">
            <span className="font-semibold text-ink">
              {integration.credentialSchema.authMethod}
            </span>
            {integration.credentialSchema.instructions
              ? ` — ${integration.credentialSchema.instructions}`
              : null}
            {integration.credentialSchema.docsUrl ? (
              <>
                {" "}
                <a
                  href={integration.credentialSchema.docsUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="font-medium text-accent underline"
                >
                  {t.t("integrations.documentation")}
                </a>
              </>
            ) : null}
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            {integration.credentialSchema.fields.map((field) => (
              <div key={field.key}>
                <label
                  htmlFor={`${slug}-${field.key}`}
                  className="mb-1.5 block text-[13px] font-medium text-ink"
                >
                  {field.label}
                  {field.required ? <span className="text-danger"> *</span> : null}
                </label>
                <input
                  id={`${slug}-${field.key}`}
                  type={field.type}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={field.placeholder}
                  value={fieldValues[field.key] ?? ""}
                  onChange={(event) =>
                    setFieldValues((current) => ({ ...current, [field.key]: event.target.value }))
                  }
                  className={cx(
                    inputClass,
                    "font-mono",
                    fieldErrors[field.key] && "border-danger",
                  )}
                />
                {fieldErrors[field.key] ? (
                  <span className="mt-1.5 block text-xs text-danger">
                    {fieldErrors[field.key]}
                  </span>
                ) : field.helpText ? (
                  <span className="type-help mt-1.5 block">{field.helpText}</span>
                ) : null}
              </div>
            ))}
          </div>

          <div className="mt-4 flex gap-2">
            <button type="submit" disabled={busy} className={buttonClass("primary")}>
              {busy ? t.t("common.saving") : t.t("integrations.saveCredentials")}
            </button>
            <button
              type="button"
              onClick={() => {
                setConfiguring(false);
                setFieldValues({});
                setFieldErrors({});
              }}
              className={buttonClass("ghost")}
            >
              {t.t("common.cancel")}
            </button>
          </div>
        </form>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 px-4 py-3.5">
        {requiresCredentials ? (
          <button
            type="button"
            onClick={() => setConfiguring((value) => !value)}
            disabled={busy}
            className={buttonClass("secondary")}
          >
            {integration.configured
              ? t.t("integrations.editCredentials")
              : t.t("integrations.configure")}
          </button>
        ) : null}

        <button
          type="button"
          onClick={testConnection}
          disabled={busy}
          className={buttonClass("secondary")}
        >
          {state.kind === "busy" && state.action === "test"
            ? t.t("aiSettings.testing")
            : t.t("integrations.testConnection")}
        </button>

        {integration.capabilities.listPrograms ? (
          <button
            type="button"
            onClick={sync}
            disabled={busy || !integration.enabled}
            title={!integration.enabled ? t.t("integrations.enableFirst") : undefined}
            className={buttonClass("primary")}
          >
            {state.kind === "busy" && state.action === "sync"
              ? t.t("integrations.syncing")
              : t.t("integrations.syncNow")}
          </button>
        ) : null}

        <button
          type="button"
          onClick={() => toggleEnabled(!integration.enabled)}
          disabled={busy}
          className={buttonClass("ghost")}
        >
          {integration.enabled ? t.t("integrations.disable") : t.t("integrations.enable")}
        </button>

        {integration.configured ? (
          <button type="button" onClick={disconnect} disabled={busy} className={buttonClass("danger")}>
            {t.t("integrations.disconnect")}
          </button>
        ) : null}

        <a
          href={`/settings/integrations/${slug.toLowerCase()}`}
          className="ml-auto text-[13px] font-medium text-accent underline underline-offset-2"
        >
          {t.t("integrations.syncHistory")}
        </a>
      </div>

      {state.kind === "error" || state.kind === "success" ? (
        <div className="border-t border-line px-4 py-3">
          <Notice tone={state.kind === "error" ? "danger" : "success"}>{state.message}</Notice>
        </div>
      ) : null}
    </section>
  );
}
