import type { ReactNode } from "react";
import Link from "next/link";
import { OPPORTUNITY_BAND_LABEL, opportunityBand } from "@/lib/enums";
import type { Translator } from "@/lib/i18n/translator";
import type { MessageKey } from "@/lib/i18n/dictionaries/en";

/**
 * Shared presentational primitives.
 *
 * Every colour comes from a semantic token (`bg-surface`, `text-ink-soft`,
 * `border-line`) — no raw hex, no theme-specific class. Components therefore
 * work identically in light and dark without a single conditional.
 *
 * These are server components; nothing here ships client JavaScript.
 */

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

// --- Layout ----------------------------------------------------------------

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="type-page-title">{title}</h1>
        {description ? <p className="type-meta mt-1.5 max-w-3xl">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/**
 * A card. Sits on `surface` above the `canvas` page background, with a visible
 * border and a shadow — three separate cues, so the separation survives in
 * both themes.
 */
export function Card({
  children,
  className,
  title,
  subtitle,
  actions,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <section
      className={cx(
        "rounded-xl border border-line bg-surface shadow-[var(--shadow-card)]",
        className,
      )}
    >
      {title ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h2 className="type-card-title">{title}</h2>
            {subtitle ? <p className="type-help mt-0.5">{subtitle}</p> : null}
          </div>
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="px-4 py-12 text-center">
      <p className="text-sm font-medium text-ink-soft">{title}</p>
      {description ? <p className="type-help mx-auto mt-1.5 max-w-md">{description}</p> : null}
    </div>
  );
}

/** Inline status message — success or failure — with an icon-free text cue. */
export function Notice({
  tone,
  children,
}: {
  tone: "success" | "danger" | "warning" | "info";
  children: ReactNode;
}) {
  const classes: Record<string, string> = {
    success: "border-success/30 bg-success-soft text-success-ink",
    danger: "border-danger/30 bg-danger-soft text-danger-ink",
    warning: "border-warning/30 bg-warning-soft text-warning-ink",
    info: "border-info/30 bg-info-soft text-info-ink",
  };

  return (
    <div role="status" className={cx("rounded-lg border px-3.5 py-2.5 text-sm", classes[tone])}>
      {children}
    </div>
  );
}

// --- Badges ----------------------------------------------------------------

type Tone = "success" | "warning" | "danger" | "info" | "neutral" | "accent";

/**
 * Badge tones use a soft background with a matching high-contrast ink colour,
 * so text stays legible in both themes. Colour is never the only signal — the
 * label always spells the state out.
 */
const TONE_CLASSES: Record<Tone, string> = {
  success: "bg-success-soft text-success-ink border-success/25",
  warning: "bg-warning-soft text-warning-ink border-warning/25",
  danger: "bg-danger-soft text-danger-ink border-danger/25",
  info: "bg-info-soft text-info-ink border-info/25",
  neutral: "bg-neutral-soft text-neutral-ink border-line",
  accent: "bg-accent-soft text-accent-ink border-accent/25",
};

export function Badge({
  children,
  tone = "neutral",
  title,
}: {
  children: ReactNode;
  tone?: Tone;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cx(
        "inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
        TONE_CLASSES[tone],
      )}
    >
      {children}
    </span>
  );
}

const CONNECTION_TONES: Record<string, Tone> = {
  CONNECTED: "success",
  READY: "success",
  NOT_CONFIGURED: "neutral",
  AUTH_ERROR: "danger",
  PERMISSION_ERROR: "danger",
  RATE_LIMITED: "warning",
  API_ERROR: "danger",
  UNSUPPORTED: "neutral",
  DISABLED: "neutral",
};

/**
 * Connection state badge.
 *
 * `READY` is reserved for local providers that have no remote API at all — the
 * Manual provider must never claim to be CONNECTED, because there is nothing
 * to connect to.
 */
export function ConnectionBadge({ status, t }: { status: string; t: Translator }) {
  return (
    <Badge tone={CONNECTION_TONES[status] ?? "neutral"}>
      {t.maybe(`connection.${status}`, status.replace(/_/g, " "))}
    </Badge>
  );
}

const SCOPE_STATUS_TONES: Record<string, Tone> = {
  IN_SCOPE: "success",
  OUT_OF_SCOPE: "neutral",
  REMOVED: "danger",
  UNKNOWN: "warning",
};

export function ScopeStatusBadge({ status, t }: { status: string; t: Translator }) {
  return (
    <Badge tone={SCOPE_STATUS_TONES[status] ?? "neutral"}>
      {t.maybe(`scopeStatus.${status}`, status.replace(/_/g, " "))}
    </Badge>
  );
}

const SEVERITY_TONES: Record<string, Tone> = {
  CRITICAL: "danger",
  HIGH: "warning",
  MEDIUM: "info",
  LOW: "neutral",
  NONE: "neutral",
};

export function SeverityBadge({ severity, t }: { severity: string | null; t: Translator }) {
  if (!severity) return <span className="text-ink-faint">—</span>;
  return (
    <Badge tone={SEVERITY_TONES[severity] ?? "neutral"}>
      {t.maybe(`severity.${severity}`, severity)}
    </Badge>
  );
}

const IMPORTANCE_TONES: Record<string, Tone> = {
  CRITICAL_ATTENTION: "danger",
  HIGH: "warning",
  MEDIUM: "info",
  LOW: "neutral",
};

export function ImportanceBadge({ importance, t }: { importance: string; t: Translator }) {
  return (
    <Badge
      tone={IMPORTANCE_TONES[importance] ?? "neutral"}
      title={
        importance === "CRITICAL_ATTENTION" ? t.t("importance.criticalHelp") : undefined
      }
    >
      {t.maybe(`importance.${importance}`, importance.replace(/_/g, " "))}
    </Badge>
  );
}

const SYNC_STATUS_TONES: Record<string, Tone> = {
  SUCCESS: "success",
  PARTIAL: "warning",
  FAILED: "danger",
  RUNNING: "info",
};

export function SyncStatusBadge({ status, t }: { status: string; t: Translator }) {
  return (
    <Badge tone={SYNC_STATUS_TONES[status] ?? "neutral"}>
      {t.maybe(`syncStatus.${status}`, status)}
    </Badge>
  );
}

const EVAL_STATUS_TONES: Record<string, Tone> = {
  COMPLETED: "success",
  FAILED: "danger",
  STALE: "warning",
  PENDING: "info",
  PROCESSING: "info",
};

export function EvalStatusBadge({ status, t }: { status: string; t: Translator }) {
  return (
    <Badge tone={EVAL_STATUS_TONES[status] ?? "neutral"}>
      {t.maybe(`evalStatus.${status}`, status)}
    </Badge>
  );
}

/**
 * Evaluation provenance badge.
 *
 * The single most important label in the product: a rule-engine score must
 * never read as model output.
 */
export function EvaluationSourceBadge({
  source,
  t,
}: {
  source: string;
  t: Translator;
}) {
  return source === "AI_MODEL" ? (
    <Badge tone="accent">{t.t("ai.sourceModel")}</Badge>
  ) : (
    <Badge tone="warning">{t.t("ai.sourceHeuristic")}</Badge>
  );
}

export function TagList({ tags, max = 5 }: { tags: string[]; max?: number }) {
  if (tags.length === 0) return <span className="text-ink-faint">—</span>;

  const shown = tags.slice(0, max);
  const remaining = tags.length - shown.length;

  return (
    <span className="flex flex-wrap gap-1">
      {shown.map((tag) => (
        <span
          key={tag}
          className="rounded bg-neutral-soft px-1.5 py-0.5 font-mono text-[11px] text-neutral-ink"
        >
          {tag}
        </span>
      ))}
      {remaining > 0 ? (
        <span className="px-1 text-[11px] text-ink-faint">+{remaining}</span>
      ) : null}
    </span>
  );
}

// --- Opportunity score -----------------------------------------------------

const BAND_TONES: Record<string, Tone> = {
  HIGH: "success",
  MEDIUM_HIGH: "info",
  MEDIUM: "warning",
  LOW: "neutral",
};

/**
 * Renders an opportunity score.
 *
 * A null score renders as an explicit "not evaluated" marker, never as 0 — the
 * difference matters when deciding what to work on next.
 */
export function OpportunityScore({
  score,
  aiStatus,
  size = "md",
  t,
}: {
  score: number | null;
  aiStatus?: string | null;
  size?: "sm" | "md" | "lg";
  t: Translator;
}) {
  const sizeClasses = size === "lg" ? "text-3xl" : size === "sm" ? "text-base" : "text-lg";

  if (score === null) {
    const label =
      aiStatus === "PENDING" || aiStatus === "PROCESSING"
        ? t.t("score.aiPending")
        : aiStatus === "FAILED"
          ? t.t("score.aiFailed")
          : aiStatus === "STALE"
            ? t.t("score.stale")
            : t.t("score.notEvaluated");

    return (
      <span className="flex flex-col gap-1 leading-tight">
        <span className={cx("font-mono font-semibold text-ink-faint", sizeClasses)}>—</span>
        <span className="text-[11px] font-medium text-ink-faint">{label}</span>
      </span>
    );
  }

  const band = opportunityBand(score);

  return (
    <span className="flex flex-col items-start gap-1 leading-tight">
      <span className={cx("font-mono font-bold tabular-nums text-ink", sizeClasses)}>{score}</span>
      <Badge tone={BAND_TONES[band] ?? "neutral"}>
        {t.maybe(`band.${band}`, OPPORTUNITY_BAND_LABEL[band])}
      </Badge>
    </span>
  );
}

export function ScoreBar({
  label,
  value,
  weight,
  help,
}: {
  label: string;
  value: number;
  weight?: number;
  help?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-44 shrink-0 text-[13px] text-ink-soft" title={help}>
        {label}
      </span>
      <span className="h-2 flex-1 overflow-hidden rounded-full bg-sunken">
        <span
          className="block h-full rounded-full bg-accent"
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      </span>
      <span className="w-9 shrink-0 text-right font-mono text-[13px] font-medium tabular-nums text-ink">
        {value}
      </span>
      {weight !== undefined ? (
        <span className="w-10 shrink-0 text-right text-[11px] text-ink-faint">
          {Math.round(weight * 100)}%
        </span>
      ) : null}
    </div>
  );
}

// --- Tables ----------------------------------------------------------------

/**
 * Tables scroll horizontally inside their own container rather than forcing the
 * page to scroll, and use a sticky header so column meaning survives a long
 * list.
 */
export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="max-h-[70vh] overflow-auto">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  );
}

export function Th({
  children,
  className,
  align = "left",
}: {
  children?: ReactNode;
  className?: string;
  align?: "left" | "right" | "center";
}) {
  return (
    <th
      scope="col"
      className={cx(
        "sticky top-0 z-10 border-b border-line bg-sunken px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-ink-soft",
        align === "right" && "text-right",
        align === "center" && "text-center",
        align === "left" && "text-left",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  className,
  align = "left",
}: {
  children?: ReactNode;
  className?: string;
  align?: "left" | "right" | "center";
}) {
  return (
    <td
      className={cx(
        "border-b border-line/60 px-3 py-2.5 align-middle",
        align === "right" && "text-right",
        align === "center" && "text-center",
        className,
      )}
    >
      {children}
    </td>
  );
}

export function Tr({ children }: { children: ReactNode }) {
  return <tr className="transition-colors hover:bg-row-hover">{children}</tr>;
}

// --- Misc ------------------------------------------------------------------

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx("font-mono", className)}>{children}</span>;
}

export function MetricCard({
  label,
  value,
  hint,
  href,
}: {
  label: string;
  value: string | number;
  hint?: string;
  href?: string;
}) {
  const body = (
    <div
      className={cx(
        "h-full rounded-xl border border-line bg-surface px-4 py-3.5 shadow-[var(--shadow-card)] transition-colors",
        href && "hover:border-accent/50 hover:bg-elevated",
      )}
    >
      <p className="type-label">{label}</p>
      <p className="mt-1.5 font-mono text-2xl font-bold tabular-nums text-ink">{value}</p>
      {hint ? <p className="type-help mt-0.5">{hint}</p> : null}
    </div>
  );

  return href ? (
    <Link href={href} className="block h-full">
      {body}
    </Link>
  ) : (
    body
  );
}

/**
 * Localised relative time.
 *
 * `now` may be passed so every timestamp on a page shares one reference
 * instant. When omitted this reads the clock: these are Server Components,
 * rendered once per request and never re-rendered on the client, so the value
 * cannot drift mid-render.
 */
export function RelativeTime({
  date,
  fallback = "—",
  now,
  t,
}: {
  date: Date | string | null;
  fallback?: string;
  now?: number;
  t: Translator;
}) {
  if (!date) return <span className="text-ink-faint">{fallback}</span>;

  const value = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(value.getTime())) return <span className="text-ink-faint">{fallback}</span>;

  // eslint-disable-next-line react-hooks/purity -- server-rendered once per request; see above
  const reference = now ?? Date.now();

  return (
    <time
      dateTime={value.toISOString()}
      title={t.formatDate(value)}
      className="whitespace-nowrap"
    >
      {t.formatRelative(value, reference)}
    </time>
  );
}

/** Before/after pair for change history. */
export function ValueDiff({
  before,
  after,
  t,
}: {
  before: string | null;
  after: string | null;
  t: Translator;
}) {
  return (
    <div className="flex flex-col gap-1.5 text-[13px]">
      <div className="flex gap-2">
        <span className="type-label w-14 shrink-0">{t.t("history.before")}</span>
        <span className="break-all font-mono text-danger-ink">{before ?? "—"}</span>
      </div>
      <div className="flex gap-2">
        <span className="type-label w-14 shrink-0">{t.t("history.after")}</span>
        <span className="break-all font-mono text-success-ink">{after ?? "—"}</span>
      </div>
    </div>
  );
}

/** Definition-list row used across detail panels. */
export function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="type-label">{label}</dt>
      <dd className="mt-1 text-[13px] text-ink-soft">{children}</dd>
    </div>
  );
}

/** Prominent key/value tile for the asset detail header. */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-3.5 py-3 shadow-[var(--shadow-card)]">
      <p className="type-label">{label}</p>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

// --- Form controls (server-rendered) ---------------------------------------

/**
 * Shared input styling.
 *
 * `bg-field` is deliberately distinct from `bg-surface` in both themes, so an
 * input never dissolves into the card behind it.
 */
export const inputClass =
  "w-full rounded-lg border border-field-border bg-field px-3 py-2 text-sm text-ink " +
  "placeholder:text-ink-faint transition-colors " +
  "hover:border-line-strong focus:border-accent focus:outline-none " +
  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent";

export function Field({
  label,
  children,
  help,
  htmlFor,
}: {
  label: string;
  children: ReactNode;
  help?: string;
  htmlFor?: string;
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={htmlFor} className="mb-1.5 block text-[13px] font-medium text-ink">
        {label}
      </label>
      {children}
      {help ? <p className="type-help mt-1.5">{help}</p> : null}
    </div>
  );
}

// --- Button hierarchy ------------------------------------------------------

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

/**
 * Four visually distinct weights, so the important action on a screen is
 * obvious. Shared by both server-rendered links and client buttons.
 */
export const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "border border-transparent bg-accent text-accent-contrast shadow-[var(--shadow-card)] hover:bg-accent-hover",
  secondary: "border border-line-strong bg-surface text-ink hover:bg-elevated hover:border-accent/50",
  ghost: "border border-transparent bg-transparent text-ink-soft hover:bg-neutral-soft hover:text-ink",
  danger: "border border-danger/40 bg-transparent text-danger hover:bg-danger-soft",
};

export const BUTTON_BASE =
  "inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-[13px] font-medium " +
  "transition-colors disabled:cursor-not-allowed disabled:opacity-55";

export function buttonClass(variant: ButtonVariant = "secondary", extra?: string): string {
  return cx(BUTTON_BASE, BUTTON_VARIANTS[variant], extra);
}

/** Link styled as a button. */
export function LinkButton({
  href,
  variant = "secondary",
  children,
  className,
}: {
  href: string;
  variant?: ButtonVariant;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link href={href} className={buttonClass(variant, className)}>
      {children}
    </Link>
  );
}

/** Plain inline text link. */
export function TextLink({
  href,
  children,
  external,
}: {
  href: string;
  children: ReactNode;
  external?: boolean;
}) {
  const className = "text-[13px] font-medium text-accent underline underline-offset-2 hover:text-accent-hover";

  return external ? (
    <a href={href} target="_blank" rel="noreferrer noopener" className={className}>
      {children}
    </a>
  ) : (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

/** Helper for translating a key that comes from data rather than a literal. */
export function tKey(t: Translator, key: string, fallback: string): string {
  return t.maybe(key, fallback);
}

export type { MessageKey };
