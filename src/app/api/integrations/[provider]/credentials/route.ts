import { NextResponse } from "next/server";
import { ApiError, jsonOk, requireApiUser, withApi } from "@/lib/api/http";
import { providerSlugSchema } from "@/lib/api/schemas";
import { deleteCredentials } from "@/lib/credentials/store";
import { getIntegrationSummary } from "@/lib/queries/integrations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** DELETE /api/integrations/:provider/credentials - disconnect. */
export const DELETE = withApi(async (request, context): Promise<NextResponse> => {
  await requireApiUser(request);
  const { provider } = await context.params;

  const parsed = providerSlugSchema.safeParse(provider?.toUpperCase());
  if (!parsed.success) throw new ApiError(404, "UNKNOWN_PROVIDER", "No such provider.");

  await deleteCredentials(parsed.data);
  return jsonOk(await getIntegrationSummary(parsed.data));
});
