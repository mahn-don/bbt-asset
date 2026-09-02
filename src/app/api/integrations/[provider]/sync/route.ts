import { NextResponse } from "next/server";
import { ApiError, jsonOk, parseJsonBody, requireApiUser, withApi } from "@/lib/api/http";
import { providerSlugSchema, syncRequestSchema } from "@/lib/api/schemas";
import { runProviderSync } from "@/lib/sync/engine";
import { getIntegrationSummary } from "@/lib/queries/integrations";
import { getAdapter } from "@/lib/providers/registry";
import { getLocale } from "@/lib/preferences";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A full provider sync walks every program and its scopes.
export const maxDuration = 300;

/** POST /api/integrations/:provider/sync - run a sync now. */
export const POST = withApi(async (request, context): Promise<NextResponse> => {
  await requireApiUser(request);
  const { provider } = await context.params;

  const parsed = providerSlugSchema.safeParse(provider?.toUpperCase());
  if (!parsed.success) throw new ApiError(404, "UNKNOWN_PROVIDER", "No such provider.");

  const slug = parsed.data;

  if (!getAdapter(slug).getCapabilities().listPrograms) {
    throw new ApiError(
      400,
      "SYNC_UNSUPPORTED",
      "This provider does not support API synchronisation. Records are entered manually.",
    );
  }

  const body = await parseJsonBody(request, syncRequestSchema).catch(() => ({
    programHandle: undefined,
  }));

  // Evaluations queued by this run are written in the operator's UI language.
  const result = await runProviderSync(slug, {
    triggerType: "MANUAL",
    programHandle: body.programHandle,
    language: await getLocale(),
  });

  return jsonOk({ result, integration: await getIntegrationSummary(slug) });
});
