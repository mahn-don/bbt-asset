import { NextResponse } from "next/server";
import { jsonOk, parseJsonBody, requireApiUser, withApi } from "@/lib/api/http";
import { preferencesSchema } from "@/lib/api/settings-schemas";
import { getUiPreferences, setUiPreference } from "@/lib/preferences";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/settings/preferences */
export const GET = withApi(async (request: Request): Promise<NextResponse> => {
  await requireApiUser(request);
  return jsonOk(await getUiPreferences());
});

/**
 * PATCH /api/settings/preferences - persist theme and/or language.
 *
 * Writes both the cookie (so the next server render is already correct) and
 * the user row (so the choice follows the account).
 */
export const PATCH = withApi(async (request: Request): Promise<NextResponse> => {
  await requireApiUser(request);
  const body = await parseJsonBody(request, preferencesSchema);

  await setUiPreference({ locale: body.locale, theme: body.theme });

  return jsonOk(await getUiPreferences());
});
