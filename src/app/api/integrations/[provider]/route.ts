import { NextResponse } from "next/server";
import { ApiError, jsonOk, parseJsonBody, requireApiUser, withApi } from "@/lib/api/http";
import { credentialsSchema, providerSlugSchema } from "@/lib/api/schemas";
import { getIntegrationSummary } from "@/lib/queries/integrations";
import { deleteCredentials, saveCredentials } from "@/lib/credentials/store";
import { getAdapter } from "@/lib/providers/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseProvider(raw: string | undefined): string {
  const result = providerSlugSchema.safeParse(raw?.toUpperCase());
  if (!result.success) {
    throw new ApiError(404, "UNKNOWN_PROVIDER", "No such provider.");
  }
  return result.data;
}

/** GET /api/integrations/:provider */
export const GET = withApi(async (request, context): Promise<NextResponse> => {
  await requireApiUser(request);
  const { provider } = await context.params;
  return jsonOk(await getIntegrationSummary(parseProvider(provider)));
});

/**
 * PUT /api/integrations/:provider - stores credentials.
 *
 * The request body is the only place plaintext credentials ever appear. They
 * are validated by the adapter, encrypted, and never returned by any endpoint.
 */
export const PUT = withApi(async (request, context): Promise<NextResponse> => {
  await requireApiUser(request);
  const { provider } = await context.params;
  const slug = parseProvider(provider);

  const adapter = getAdapter(slug);
  if (!adapter.getCapabilities().requiresCredentials) {
    throw new ApiError(400, "NO_CREDENTIALS_REQUIRED", "This provider does not use credentials.");
  }

  const body = await parseJsonBody(request, credentialsSchema);

  const validation = adapter.validateCredentials(body.credentials);
  if (!validation.valid) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_CREDENTIALS",
          message: validation.message ?? "Credentials are invalid.",
          fieldErrors: validation.fieldErrors ?? {},
        },
      },
      { status: 422 },
    );
  }

  await saveCredentials(slug, body.credentials);

  return jsonOk(await getIntegrationSummary(slug));
});

/** DELETE /api/integrations/:provider - alias for credential removal. */
export const DELETE = withApi(async (request, context): Promise<NextResponse> => {
  await requireApiUser(request);
  const { provider } = await context.params;
  const slug = parseProvider(provider);

  await deleteCredentials(slug);
  return jsonOk(await getIntegrationSummary(slug));
});
