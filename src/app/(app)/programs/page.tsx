import Link from "next/link";
import { prisma } from "@/lib/db";
import { getUiPreferences } from "@/lib/preferences";
import { createTranslator } from "@/lib/i18n/translator";
import { renderNow } from "@/lib/render-clock";
import {
  Badge,
  Card,
  EmptyState,
  Mono,
  PageHeader,
  RelativeTime,
  Table,
  Td,
  Th,
  Tr,
} from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ProgramsPage() {
  const { locale } = await getUiPreferences();
  const t = createTranslator(locale);
  const now = renderNow();

  const programs = await prisma.program.findMany({
    orderBy: [{ provider: { slug: "asc" } }, { name: "asc" }],
    include: {
      provider: { select: { slug: true, name: true } },
      _count: { select: { scopes: true } },
    },
    take: 500,
  });

  // Active scope counts per program, in one grouped query rather than N.
  const activeCounts = await prisma.scope.groupBy({
    by: ["programId"],
    where: { scopeStatus: "IN_SCOPE" },
    _count: { _all: true },
  });

  const activeByProgram = new Map(activeCounts.map((row) => [row.programId, row._count._all]));

  return (
    <>
      <PageHeader title={t.t("programs.title")} description={t.t("programs.description")} />

      <Card title={t.plural("programs.count", programs.length)}>
        {programs.length === 0 ? (
          <EmptyState title={t.t("programs.empty")} description={t.t("programs.emptyHelp")} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t.t("assets.col.program")}</Th>
                <Th>{t.t("assets.col.provider")}</Th>
                <Th>{t.t("programs.col.handle")}</Th>
                <Th>{t.t("assets.col.status")}</Th>
                <Th>{t.t("asset.visibility")}</Th>
                <Th align="right">{t.t("programs.col.scopes")}</Th>
                <Th align="right">{t.t("programs.col.active")}</Th>
                <Th align="right">{t.t("programs.col.bountyMax")}</Th>
                <Th>{t.t("programs.col.lastSynced")}</Th>
              </tr>
            </thead>
            <tbody>
              {programs.map((program) => (
                <Tr key={program.id}>
                  <Td>
                    <Link
                      href={`/assets?programId=${program.id}`}
                      className="text-sm font-medium text-ink hover:text-accent"
                    >
                      {program.name}
                    </Link>
                  </Td>
                  <Td>
                    <Badge tone={program.provider.slug === "MANUAL" ? "warning" : "neutral"}>
                      {program.provider.slug}
                    </Badge>
                  </Td>
                  <Td>
                    <Mono className="text-[13px] text-ink-soft">{program.handleOrSlug}</Mono>
                  </Td>
                  <Td>
                    <Badge tone={program.status === "ACTIVE" ? "success" : "neutral"}>
                      {t.maybe(`programStatus.${program.status}`, program.status)}
                    </Badge>
                  </Td>
                  <Td className="text-ink-soft">
                    {t.maybe(`visibility.${program.visibility}`, program.visibility)}
                  </Td>
                  <Td align="right">
                    <Mono className="text-ink">{program._count.scopes}</Mono>
                  </Td>
                  <Td align="right">
                    <Mono className="text-ink">{activeByProgram.get(program.id) ?? 0}</Mono>
                  </Td>
                  <Td align="right" className="text-ink-soft">
                    {program.bountyMax !== null ? (
                      <Mono>{t.formatCurrency(program.bountyMax, program.currency)}</Mono>
                    ) : (
                      <span className="text-ink-faint">—</span>
                    )}
                  </Td>
                  <Td className="text-ink-soft">
                    <RelativeTime
                      date={program.lastSyncedAt}
                      fallback={t.t("common.never")}
                      now={now}
                      t={t}
                    />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
