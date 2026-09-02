import Link from "next/link";
import { assetsQuerySchema } from "@/lib/api/schemas";
import { listAssets, listKnownTags } from "@/lib/queries/assets";
import { prisma } from "@/lib/db";
import { ASSET_TYPES, PROVIDER_SLUGS, SCOPE_STATUSES, SEVERITIES } from "@/lib/enums";
import { getUiPreferences } from "@/lib/preferences";
import { createTranslator, type Translator } from "@/lib/i18n/translator";
import { renderNow } from "@/lib/render-clock";
import {
  Badge,
  Card,
  EmptyState,
  Notice,
  OpportunityScore,
  PageHeader,
  RelativeTime,
  ScopeStatusBadge,
  SeverityBadge,
  Table,
  TagList,
  Td,
  Th,
  Tr,
  buttonClass,
  inputClass,
} from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * Asset explorer.
 *
 * Filtering is a plain GET form: every filter is bookmarkable, works without
 * JavaScript, and is validated by the same schema the API uses.
 */
export default async function AssetsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await getUiPreferences();
  const t = createTranslator(locale);

  const raw = await searchParams;

  // Drop blank values so an empty select does not fail enum validation.
  const cleaned: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    const single = Array.isArray(value) ? value[0] : value;
    if (single !== undefined && single !== "") cleaned[key] = single;
  }

  const parsed = assetsQuerySchema.safeParse(cleaned);
  const query = parsed.success ? parsed.data : assetsQuerySchema.parse({});

  const [result, programs, tags] = await Promise.all([
    listAssets(query),
    prisma.program.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
      take: 500,
    }),
    listKnownTags(30),
  ]);

  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const now = renderNow();

  return (
    <>
      <PageHeader title={t.t("assets.title")} description={t.t("assets.description")} />

      {!parsed.success ? (
        <div className="mb-4">
          <Notice tone="warning">{t.t("assets.invalidFilters")}</Notice>
        </div>
      ) : null}

      <form
        method="GET"
        className="mb-5 rounded-xl border border-line bg-surface p-4 shadow-[var(--shadow-card)]"
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <FilterField label={t.t("filter.search")} htmlFor="f-search">
            <input
              id="f-search"
              type="search"
              name="search"
              defaultValue={query.search ?? ""}
              placeholder={t.t("filter.searchPlaceholder")}
              className={inputClass}
            />
          </FilterField>

          <FilterField label={t.t("filter.provider")} htmlFor="f-provider">
            <select
              id="f-provider"
              name="provider"
              defaultValue={query.provider?.[0] ?? ""}
              className={inputClass}
            >
              <option value="">{t.t("common.all")}</option>
              {PROVIDER_SLUGS.map((slug) => (
                <option key={slug} value={slug}>
                  {slug}
                </option>
              ))}
            </select>
          </FilterField>

          <FilterField label={t.t("filter.program")} htmlFor="f-program">
            <select
              id="f-program"
              name="programId"
              defaultValue={query.programId ?? ""}
              className={inputClass}
            >
              <option value="">{t.t("common.all")}</option>
              {programs.map((program) => (
                <option key={program.id} value={program.id}>
                  {program.name}
                </option>
              ))}
            </select>
          </FilterField>

          <FilterField label={t.t("filter.type")} htmlFor="f-type">
            <select
              id="f-type"
              name="assetType"
              defaultValue={query.assetType?.[0] ?? ""}
              className={inputClass}
            >
              <option value="">{t.t("common.all")}</option>
              {ASSET_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </FilterField>

          <FilterField label={t.t("filter.scopeStatus")} htmlFor="f-status">
            <select
              id="f-status"
              name="scopeStatus"
              defaultValue={query.scopeStatus?.[0] ?? ""}
              className={inputClass}
            >
              <option value="">{t.t("filter.scopeStatusDefault")}</option>
              {SCOPE_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {t.maybe(`scopeStatus.${status}`, status.replace(/_/g, " "))}
                </option>
              ))}
            </select>
          </FilterField>

          <FilterField label={t.t("filter.maxSeverity")} htmlFor="f-severity">
            <select
              id="f-severity"
              name="maxSeverity"
              defaultValue={query.maxSeverity?.[0] ?? ""}
              className={inputClass}
            >
              <option value="">{t.t("common.all")}</option>
              {SEVERITIES.map((severity) => (
                <option key={severity} value={severity}>
                  {t.maybe(`severity.${severity}`, severity)}
                </option>
              ))}
            </select>
          </FilterField>

          <FilterField label={t.t("filter.bountyEligible")} htmlFor="f-bounty">
            <select
              id="f-bounty"
              name="bountyEligible"
              defaultValue={query.bountyEligible === undefined ? "" : String(query.bountyEligible)}
              className={inputClass}
            >
              <option value="">{t.t("common.any")}</option>
              <option value="true">{t.t("common.yes")}</option>
              <option value="false">{t.t("common.no")}</option>
            </select>
          </FilterField>

          <FilterField label={t.t("filter.tag")} htmlFor="f-tag">
            <select id="f-tag" name="tags" defaultValue={query.tags?.[0] ?? ""} className={inputClass}>
              <option value="">{t.t("common.any")}</option>
              {tags.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </select>
          </FilterField>

          <FilterField label={t.t("filter.minScore")} htmlFor="f-min">
            <input
              id="f-min"
              type="number"
              name="minScore"
              min={0}
              max={100}
              defaultValue={query.minScore ?? ""}
              className={inputClass}
            />
          </FilterField>

          <FilterField label={t.t("filter.maxScore")} htmlFor="f-max">
            <input
              id="f-max"
              type="number"
              name="maxScore"
              min={0}
              max={100}
              defaultValue={query.maxScore ?? ""}
              className={inputClass}
            />
          </FilterField>

          <FilterField label={t.t("common.sort")} htmlFor="f-sort">
            <select id="f-sort" name="sort" defaultValue={query.sort} className={inputClass}>
              <option value="opportunity">{t.t("sort.opportunity")}</option>
              <option value="newest">{t.t("sort.newest")}</option>
              <option value="recentlyChanged">{t.t("sort.recentlyChanged")}</option>
              <option value="severity">{t.t("sort.severity")}</option>
              <option value="leastReviewed">{t.t("sort.leastReviewed")}</option>
            </select>
          </FilterField>

          <FilterField label={t.t("common.perPage")} htmlFor="f-size">
            <select
              id="f-size"
              name="pageSize"
              defaultValue={String(query.pageSize)}
              className={inputClass}
            >
              {[25, 50, 100, 200].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </FilterField>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-line pt-4">
          <Checkbox name="isNew" label={t.t("filter.isNew")} checked={query.isNew === true} />
          <Checkbox
            name="recentlyChanged"
            label={t.t("filter.recentlyChanged")}
            checked={query.recentlyChanged === true}
          />
          <Checkbox
            name="notEvaluated"
            label={t.t("filter.notEvaluated")}
            checked={query.notEvaluated === true}
          />
          <Checkbox
            name="notReviewed"
            label={t.t("filter.notReviewed")}
            checked={query.notReviewed === true}
          />

          <div className="ml-auto flex gap-2">
            <button type="submit" className={buttonClass("primary")}>
              {t.t("common.apply")}
            </button>
            <Link href="/assets" className={buttonClass("ghost")}>
              {t.t("common.reset")}
            </Link>
          </div>
        </div>
      </form>

      <Card
        title={t.plural("assets.count", result.total)}
        subtitle={
          result.unevaluatedCount > 0
            ? t.t("assets.unevaluatedNote", { count: result.unevaluatedCount })
            : undefined
        }
      >
        {result.items.length === 0 ? (
          <EmptyState title={t.t("assets.empty")} description={t.t("assets.emptyHelp")} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th className="w-24">{t.t("assets.col.score")}</Th>
                <Th>{t.t("assets.col.asset")}</Th>
                <Th>{t.t("assets.col.program")}</Th>
                <Th>{t.t("assets.col.provider")}</Th>
                <Th>{t.t("assets.col.type")}</Th>
                <Th>{t.t("assets.col.status")}</Th>
                <Th align="center">{t.t("assets.col.bounty")}</Th>
                <Th align="center">{t.t("assets.col.maxSeverity")}</Th>
                <Th>{t.t("assets.col.tags")}</Th>
                <Th>{t.t("assets.col.lastChanged")}</Th>
                <Th align="right">{t.t("assets.col.coverage")}</Th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((item) => (
                <Tr key={item.id}>
                  <Td>
                    <OpportunityScore
                      score={item.opportunityScore}
                      aiStatus={item.aiStatus}
                      size="sm"
                      t={t}
                    />
                  </Td>
                  <Td>
                    {/* Primary data: heavier than the metadata around it. */}
                    <Link
                      href={`/assets/${item.id}`}
                      className="break-all font-mono text-sm font-medium text-ink hover:text-accent"
                    >
                      {item.assetIdentifier}
                    </Link>
                    <span className="ml-2 inline-flex gap-1 align-middle">
                      {item.isNew ? <Badge tone="accent">{t.t("badge.new")}</Badge> : null}
                      {item.isChanged ? <Badge tone="info">{t.t("badge.changed")}</Badge> : null}
                    </span>
                  </Td>
                  <Td className="text-ink">{item.program.name}</Td>
                  <Td>
                    <Badge tone="neutral">{item.provider}</Badge>
                  </Td>
                  <Td className="text-ink-soft">{item.assetType}</Td>
                  <Td>
                    <ScopeStatusBadge status={item.scopeStatus} t={t} />
                  </Td>
                  <Td align="center">
                    {item.eligibleForBounty ? (
                      <Badge tone="success">{t.t("common.yes")}</Badge>
                    ) : (
                      <span className="text-ink-faint">{t.t("common.no")}</span>
                    )}
                  </Td>
                  <Td align="center">
                    <SeverityBadge severity={item.maxSeverity} t={t} />
                  </Td>
                  <Td>
                    <TagList tags={item.tags} max={3} />
                  </Td>
                  <Td className="text-ink-soft">
                    <RelativeTime date={item.lastChangedAt} now={now} t={t} />
                  </Td>
                  <Td align="right" className="text-ink-soft">
                    {/* Research coverage is only meaningful once sessions exist. */}
                    {item.researchSessionCount > 0 ? (
                      t.plural("assets.sessions", item.researchSessionCount)
                    ) : (
                      <span className="text-ink-faint">—</span>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}

        {totalPages > 1 ? (
          <nav
            className="flex items-center justify-between border-t border-line px-4 py-3"
            aria-label={t.t("common.pagination")}
          >
            <span className="type-meta">
              {t.t("common.pageOf", { page: result.page, total: totalPages })}
            </span>
            <span className="flex gap-2">
              {result.page > 1 ? (
                <Link href={pageHref(cleaned, result.page - 1)} className={buttonClass("secondary")}>
                  {t.t("common.previous")}
                </Link>
              ) : null}
              {result.page < totalPages ? (
                <Link href={pageHref(cleaned, result.page + 1)} className={buttonClass("secondary")}>
                  {t.t("common.next")}
                </Link>
              ) : null}
            </span>
          </nav>
        ) : null}
      </Card>
    </>
  );
}

function FilterField({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-medium text-ink-soft">
        {label}
      </label>
      {children}
    </div>
  );
}

function Checkbox({ name, label, checked }: { name: string; label: string; checked: boolean }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink-soft hover:text-ink">
      <input
        type="checkbox"
        name={name}
        value="true"
        defaultChecked={checked}
        className="h-4 w-4 accent-accent"
      />
      {label}
    </label>
  );
}

function pageHref(params: Record<string, string>, page: number): string {
  const search = new URLSearchParams({ ...params, page: String(page) });
  return `/assets?${search.toString()}`;
}

export type { Translator };
