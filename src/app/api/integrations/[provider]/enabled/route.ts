import { NextResponse } from "next/server";
import { ApiError, jsonOk, parseJsonBody, requireApiUser, withApi } from "@/lib/api/http";
import { providerSlugSchema, setEnabledSchema } from "@/lib/api/schemas";
import { hasCredentials, setEnabled } from "@/lib/credentials/store";
import { getIntegrationSummary } from "@/lib/queries/integrations";
import { getAdapter } from "@/lib/providers/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PATCH /api/integrations/:provider/enabled */
export const PATCH = withApi(async (request, context): Promise<NextResponse> => {
  await requireApiUser(request);
  const { provider } = await context.params;

  const parsed = providerSlugSchema.safeParse(provider?.toUpperCase());
  if (!parsed.success) throw new ApiError(404, "UNKNOWN_PROVIDER", "No such provider.");

  const slug = parsed.data;
  const body = await parseJsonBody(request, setEnabledSchema);

  // Enabling a credential-backed provider with nothing stored would produce an
  // integration that claims to be on but cannot do anything.
  if (body.enabled && getAdapter(slug).getCapabilities().requiresCredentials) {
    if (!(await hasCredentials(slug))) {
      throw new ApiError(
        409,
        "NOT_CONFIGURED",
        "Store credentials before enabling this integration.",
      );
    }
  }

  await setEnabled(slug, body.enabled);
  return jsonOk(await getIntegrationSummary(slug));
});
