import Link from "next/link";
import { prisma } from "@/lib/db";
import { CHANGE_TYPES } from "@/lib/enums";
import { getUiPreferences } from "@/lib/preferences";
import { createTranslator } from "@/lib/i18n/translator";
import { renderNow } from "@/lib/render-clock";
import {
  Badge,
  Card,
  EmptyState,
  ImportanceBadge,
  Mono,
  PageHeader,
  RelativeTime,
  ValueDiff,
  buttonClass,
  inputClass,
} from "@/components/ui";
import type { Prisma } from "@/generated/prisma";

export const dynamic = "force-dynamic";

export default async function ChangesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await getUiPreferences();
  const t = createTranslator(locale);
  const now = renderNow();

  const raw = await searchParams;
  const changeTypeParam = typeof raw.changeType === "string" ? raw.changeType : "";
  const importanceParam = typeof raw.importance === "string" ? raw.importance : "";

  const where: Prisma.ChangeEventWhereInput = {};
  if ((CHANGE_TYPES as readonly string[]).includes(changeTypeParam)) {
    where.changeType = changeTypeParam;
  }
  if (["LOW", "MEDIUM", "HIGH", "CRITICAL_ATTENTION"].includes(importanceParam)) {
    where.importance = importanceParam;
  }

  const changes = await prisma.changeEvent.findMany({
    where,
    orderBy: { detectedAt: "desc" },
    take: 200,
    include: {
      provider: { select: { slug: true } },
      program: { select: { id: true, name: true } },
      scope: { select: { id: true, assetIdentifier: true, assetType: true } },
    },
  });

  return (
    <>
      <PageHeader title={t.t("changes.title")} description={t.t("changes.description")} />

      <form method="GET" className="mb-5 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="c-type" className="mb-1.5 block text-xs font-medium text-ink-soft">
            {t.t("changes.type")}
          </label>
          <select id="c-type" name="changeType" defaultValue={changeTypeParam} className={inputClass}>
            <option value="">{t.t("common.all")}</option>
            {CHANGE_TYPES.map((type) => (
              <option key={type} value={type}>
                {t.maybe(`changeType.${type}`, type.replace(/_/g, " "))}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="c-imp" className="mb-1.5 block text-xs font-medium text-ink-soft">
            {t.t("changes.importance")}
          </label>
          <select id="c-imp" name="importance" defaultValue={importanceParam} className={inputClass}>
            <option value="">{t.t("common.all")}</option>
            {["CRITICAL_ATTENTION", "HIGH", "MEDIUM", "LOW"].map((level) => (
              <option key={level} value={level}>
                {t.maybe(`importance.${level}`, level.replace(/_/g, " "))}
              </option>
            ))}
          </select>
        </div>

        <button type="submit" className={buttonClass("primary")}>
          {t.t("changes.filter")}
        </button>
        <Link href="/changes" className={buttonClass("ghost")}>
          {t.t("common.reset")}
        </Link>
      </form>

      <Card title={t.plural("changes.count", changes.length)}>
        {changes.length === 0 ? (
          <EmptyState title={t.t("changes.empty")} description={t.t("changes.emptyHelp")} />
        ) : (
          <ul className="divide-y divide-line/60">
            {changes.map((change) => (
              <li key={change.id} className="px-4 py-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="neutral">
                    {t.maybe(`changeType.${change.changeType}`, change.changeType.replace(/_/g, " "))}
                  </Badge>
                  <ImportanceBadge importance={change.importance} t={t} />
                  <Badge tone="neutral">{change.provider.slug}</Badge>
                  {change.fieldName ? (
                    <Mono className="text-xs text-ink-soft">{change.fieldName}</Mono>
                  ) : null}
                  <span className="ml-auto text-xs text-ink-faint">
                    <RelativeTime date={change.detectedAt} now={now} t={t} />
                  </span>
                </div>

                <p className="mt-1.5 text-[13px]">
                  {change.scope ? (
                    <Link
                      href={`/assets/${change.scope.id}`}
                      className="font-mono font-medium text-ink hover:text-accent"
                    >
                      {change.scope.assetIdentifier}
                    </Link>
                  ) : null}
                  <span className="text-ink-faint">
                    {change.scope ? " · " : ""}
                    {change.program?.name ?? t.t("changes.programLevel")}
                  </span>
                </p>

                {change.oldValue !== null || change.newValue !== null ? (
                  <div className="mt-2.5 max-w-3xl">
                    <ValueDiff before={change.oldValue} after={change.newValue} t={t} />
                  </div>
                ) : null}

                {change.aiSummary ? (
                  <p className="type-meta mt-2 max-w-3xl">{change.aiSummary}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
