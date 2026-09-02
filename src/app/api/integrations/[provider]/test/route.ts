import { NextResponse } from "next/server";
import { ApiError, jsonOk, requireApiUser, withApi } from "@/lib/api/http";
import { providerSlugSchema } from "@/lib/api/schemas";
import { getAdapter } from "@/lib/providers/registry";
import { loadCredentials, setConnectionStatus } from "@/lib/credentials/store";
import { getIntegrationSummary } from "@/lib/queries/integrations";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/integrations/:provider/test
 *
 * Performs a real API call against the provider and records the true outcome.
 * A success state is never synthesised - if the provider is unreachable or the
 * credential is rejected, that is exactly what gets stored and displayed.
 */
export const POST = withApi(async (request, context): Promise<NextResponse> => {
  await requireApiUser(request);
  const { provider } = await context.params;

  const parsed = providerSlugSchema.safeParse(provider?.toUpperCase());
  if (!parsed.success) throw new ApiError(404, "UNKNOWN_PROVIDER", "No such provider.");

  const slug = parsed.data;
  const adapter = getAdapter(slug);

  const credentials = await loadCredentials(slug);
  if (credentials === null) {
    await setConnectionStatus(slug, "NOT_CONFIGURED", {
      code: "NO_CREDENTIALS",
      summary: "No credentials are stored for this provider.",
    });
    return jsonOk({
      result: {
        status: "NOT_CONFIGURED",
        code: "NO_CREDENTIALS",
        message: "No credentials are stored for this provider.",
      },
      integration: await getIntegrationSummary(slug),
    });
  }

  const result = await adapter.testConnection(credentials);

  await setConnectionStatus(
    slug,
    result.status,
    result.status === "CONNECTED"
      ? undefined
      : { code: result.code, summary: result.message },
  );

  logger.info("connection test completed", { provider: slug, status: result.status });

  return jsonOk({ result, integration: await getIntegrationSummary(slug) });
});
